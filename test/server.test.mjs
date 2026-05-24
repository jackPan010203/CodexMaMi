import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("server exposes health and masked config", async () => {
  await withServer(async ({ port }) => {
    const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.configExists, true);

    const config = await fetchJson(`http://127.0.0.1:${port}/api/config`);
    assert.equal(config.summary.model, "gpt-test");
    assert.match(config.masked, /API_KEY = "sk-s/);
    assert.doesNotMatch(config.masked, /secret-value/);
  });
});

test("account capture and apply creates a backup", async () => {
  await withServer(async ({ port, codexHome }) => {
    const captured = await fetchJson(`http://127.0.0.1:${port}/api/accounts/capture`, {
      method: "POST",
      body: JSON.stringify({ name: "Main", note: "test profile" })
    });
    assert.equal(captured.account.name, "Main");
    assert.equal(captured.account.configRaw, undefined);

    const configPath = path.join(codexHome, "config.toml");
    await fs.writeFile(configPath, 'model_provider = "other"\nmodel = "gpt-other"\n', "utf8");

    const preview = await fetchJson(`http://127.0.0.1:${port}/api/accounts/${captured.account.id}/preview`, {
      method: "POST"
    });
    assert.match(preview.diff, /gpt-other/);
    assert.match(preview.diff, /gpt-test/);

    await fetchJson(`http://127.0.0.1:${port}/api/accounts/${captured.account.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });

    const restored = await fs.readFile(configPath, "utf8");
    assert.match(restored, /gpt-test/);
    const backups = await fetchJson(`http://127.0.0.1:${port}/api/backups`);
    assert.equal(backups.backups.length, 1);
  });
});

test("provider route preview and apply writes managed block", async () => {
  await withServer(async ({ port, codexHome }) => {
    const created = await fetchJson(`http://127.0.0.1:${port}/api/providers`, {
      method: "POST",
      body: JSON.stringify({
        name: "Local",
        baseUrl: "http://127.0.0.1:9999/v1",
        apiKey: "sk-provider-secret",
        models: "gpt-route",
        defaultModel: "gpt-route"
      })
    });
    assert.equal(created.provider.hasApiKey, true);
    assert.doesNotMatch(created.provider.apiKey, /provider-secret/);

    const preview = await fetchJson(`http://127.0.0.1:${port}/api/providers/${created.provider.id}/route-preview`, {
      method: "POST"
    });
    assert.match(preview.diff, /CODEXMAMI ROUTING/);
    assert.match(preview.diff, /gpt-route/);

    await fetchJson(`http://127.0.0.1:${port}/api/providers/${created.provider.id}/apply-route`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    const raw = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.match(raw, /BEGIN CODEXMAMI ROUTING/);
    assert.match(raw, /model_provider = "codexmami"/);
  });
});

test("mcp preview, apply, and delete update config with backups", async () => {
  await withServer(async ({ port, codexHome }) => {
    const mcp = {
      name: "demo-tools",
      command: "demo.exe",
      cwd: "C:\\Tools\\Demo",
      args: "--stdio",
      env: "API_TOKEN=sk-mcp-secret",
      enabled: true
    };

    const preview = await fetchJson(`http://127.0.0.1:${port}/api/mcp/preview`, {
      method: "POST",
      body: JSON.stringify(mcp)
    });
    assert.match(preview.diff, /mcp_servers.demo-tools/);
    assert.doesNotMatch(preview.diff, /mcp-secret/);

    await fetchJson(`http://127.0.0.1:${port}/api/mcp/apply`, {
      method: "POST",
      body: JSON.stringify({ ...mcp, confirm: true })
    });
    let raw = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.match(raw, /\[mcp_servers\.demo-tools\]/);
    assert.match(raw, /API_TOKEN = "sk-mcp-secret"/);

    const mcpTest = await fetchJson(`http://127.0.0.1:${port}/api/mcp/demo-tools/test`, {
      method: "POST"
    });
    assert.equal(mcpTest.ok, false);
    assert.equal(mcpTest.stage, "command");

    const deletePreview = await fetchJson(`http://127.0.0.1:${port}/api/mcp/demo-tools/delete-preview`, {
      method: "POST"
    });
    assert.match(deletePreview.diff, /demo-tools/);

    await fetchJson(`http://127.0.0.1:${port}/api/mcp/demo-tools/delete`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    raw = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.doesNotMatch(raw, /demo-tools/);
  });
});

test("maintenance diagnose and cleanup operate on app exports only", async () => {
  await withServer(async ({ port, appHome }) => {
    const diagnosis = await fetchJson(`http://127.0.0.1:${port}/api/maintenance/diagnose`);
    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.counts.mcp, 1);

    const exportsDir = path.join(appHome, "exports");
    await fs.mkdir(exportsDir, { recursive: true });
    const exportPath = path.join(exportsDir, "sample.md");
    await fs.writeFile(exportPath, "# sample", "utf8");

    const targets = await fetchJson(`http://127.0.0.1:${port}/api/maintenance/cleanup-targets`);
    assert.equal(targets.targets.length, 1);

    const cleanup = await fetchJson(`http://127.0.0.1:${port}/api/maintenance/cleanup`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    assert.equal(cleanup.deleted.length, 1);
    await assert.rejects(fs.access(exportPath));
  });
});

test("publish safety scan reports gitignore checks", async () => {
  await withServer(async ({ port }) => {
    const safety = await fetchJson(`http://127.0.0.1:${port}/api/maintenance/publish-safety`);
    assert.ok(Array.isArray(safety.checks));
    assert.ok(Array.isArray(safety.findings));
    assert.ok(safety.checks.some((item) => item.name.includes(".codexmami-dev")));
  });
});

test("skills import, backup, restore and preferences are available", async () => {
  await withServer(async ({ port, codexHome }) => {
    const prefs = await fetchJson(`http://127.0.0.1:${port}/api/preferences`);
    assert.equal(prefs.preferences.groupSessionsByProject, true);

    const savedPrefs = await fetchJson(`http://127.0.0.1:${port}/api/preferences`, {
      method: "POST",
      body: JSON.stringify({
        startView: "skills",
        autoRefreshSec: 30,
        showArchivedSessions: true
      })
    });
    assert.equal(savedPrefs.preferences.startView, "skills");
    assert.equal(savedPrefs.preferences.autoRefreshSec, 30);
    assert.equal(savedPrefs.preferences.showArchivedSessions, true);

    const created = await fetchJson(`http://127.0.0.1:${port}/api/skills/import`, {
      method: "POST",
      body: JSON.stringify({
        name: "My Test Skill",
        content: "# My Test Skill\n\ndescription: local skill for test\n"
      })
    });
    assert.match(created.created.path, /SKILL\.md$/);

    const skillList = await fetchJson(`http://127.0.0.1:${port}/api/skills`);
    const localSkill = skillList.skills.find((item) => item.name === "My Test Skill");
    assert.equal(localSkill.source, "local");

    const backup = await fetchJson(`http://127.0.0.1:${port}/api/skills/backups`, {
      method: "POST",
      body: JSON.stringify({ reason: "test-backup" })
    });
    assert.equal(backup.backup.reason, "test-backup");

    await fetchJson(`http://127.0.0.1:${port}/api/skills/${localSkill.id}/delete`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    const afterDelete = await fetchJson(`http://127.0.0.1:${port}/api/skills`);
    assert.equal(afterDelete.skills.some((item) => item.name === "My Test Skill"), false);

    await fetchJson(`http://127.0.0.1:${port}/api/skills/backups/${backup.backup.id}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    const afterRestore = await fetchJson(`http://127.0.0.1:${port}/api/skills`);
    assert.equal(afterRestore.skills.some((item) => item.name === "My Test Skill"), true);

    const paths = await fetchJson(`http://127.0.0.1:${port}/api/paths`);
    assert.equal(paths.paths.skillsDir, path.join(codexHome, "skills"));
  });
});

test("session summary export and detail API are available", async () => {
  await withServer(async ({ port, codexHome }) => {
    const sessionsDir = path.join(codexHome, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, "sample.jsonl");
    await fs.writeFile(sessionFile, [
      JSON.stringify({ session_meta: { payload: { id: "thread-test" } }, cwd: "C:\\Work\\Demo" }),
      JSON.stringify({ role: "user", content: "Please summarize this project." }),
      JSON.stringify({ role: "assistant", content: "Here is a short summary." })
    ].join("\n"), "utf8");

    const list = await fetchJson(`http://127.0.0.1:${port}/api/sessions`);
    const session = list.sessions.find((item) => item.threadId === "thread-test");
    assert.ok(session);

    const detail = await fetchJson(`http://127.0.0.1:${port}/api/sessions/${session.id}`);
    assert.equal(detail.session.path, sessionFile);

    const summary = await fetchJson(`http://127.0.0.1:${port}/api/sessions/${session.id}/summary-export`, {
      method: "POST"
    });
    assert.match(summary.summary, /Messages scanned/);
    assert.match(summary.path, /summary\.md$/);
  });
});

test("account bundle export/import and release check are available", async () => {
  await withServer(async ({ port }) => {
    const captured = await fetchJson(`http://127.0.0.1:${port}/api/accounts/capture`, {
      method: "POST",
      body: JSON.stringify({ name: "Bundle Test", note: "export me" })
    });

    const bundle = await fetchJson(`http://127.0.0.1:${port}/api/accounts/${captured.account.id}/export`);
    assert.equal(bundle.schema, "codexmami-account-bundle@1");
    assert.equal(bundle.account.name, "Bundle Test");
    assert.match(bundle.account.configRaw, /gpt-test/);

    const imported = await fetchJson(`http://127.0.0.1:${port}/api/accounts/import`, {
      method: "POST",
      body: JSON.stringify(bundle)
    });
    assert.equal(imported.account.name, "Bundle Test");

    const releaseBefore = await fetchJson(`http://127.0.0.1:${port}/api/release/check`);
    assert.equal(releaseBefore.currentVersion, "0.1.0");
    assert.equal(releaseBefore.releaseConfigured, false);

    const prefs = await fetchJson(`http://127.0.0.1:${port}/api/preferences`, {
      method: "POST",
      body: JSON.stringify({
        releaseLatestVersion: "0.2.0",
        releaseLatestNotes: "Test release notes"
      })
    });
    assert.equal(prefs.preferences.releaseLatestVersion, "0.2.0");

    const releaseAfter = await fetchJson(`http://127.0.0.1:${port}/api/release/check`);
    assert.equal(releaseAfter.latestVersion, "0.2.0");
    assert.equal(releaseAfter.hasUpdate, true);
    assert.equal(releaseAfter.latestNotes, "Test release notes");
  });
});

test("account status refresh and release environment check are available", async () => {
  await withServer(async ({ port }) => {
    const captured = await fetchJson(`http://127.0.0.1:${port}/api/accounts/capture`, {
      method: "POST",
      body: JSON.stringify({ name: "Status Test", note: "refresh me" })
    });

    const refreshed = await fetchJson(`http://127.0.0.1:${port}/api/accounts/${captured.account.id}/status-refresh`, {
      method: "POST"
    });
    assert.equal(refreshed.account.usage.status, "ready");
    assert.match(refreshed.account.usage.statusNote, /provider|模型/);

    const environment = await fetchJson(`http://127.0.0.1:${port}/api/release/environment`);
    assert.ok(Array.isArray(environment.checks));
    assert.ok(environment.checks.some((item) => item.name === "node"));
    assert.ok(environment.checks.some((item) => item.name === "Tauri config"));
  });
});

test("account metadata can be edited locally", async () => {
  await withServer(async ({ port }) => {
    const captured = await fetchJson(`http://127.0.0.1:${port}/api/accounts/capture`, {
      method: "POST",
      body: JSON.stringify({ name: "Editable Account", note: "before edit" })
    });

    const updated = await fetchJson(`http://127.0.0.1:${port}/api/accounts/${captured.account.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ownerLabel: "Main owner",
        planName: "Pro",
        lifecycle: "active",
        renewalDate: "2026-06-01",
        quotaResetDate: "2026-06-15",
        quotaUsed: 1200,
        quotaLimit: 5000,
        quotaUnit: "requests",
        statusNote: "Tracked manually",
        privateNote: "Do not publish"
      })
    });

    assert.equal(updated.account.usage.ownerLabel, "Main owner");
    assert.equal(updated.account.usage.planName, "Pro");
    assert.equal(updated.account.usage.lifecycle, "active");
    assert.equal(updated.account.usage.quotaRemaining, 3800);
    assert.equal(updated.account.usage.privateNote, "Do not publish");
  });
});

test("release draft and artifact scan are available", async () => {
  await withServer(async ({ port }) => {
    const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle", "msi");
    await fs.mkdir(bundleRoot, { recursive: true });
    const artifactPath = path.join(bundleRoot, "CodexMaMi_0.1.0_x64_en-US.msi");
    await fs.writeFile(artifactPath, "fake-installer", "utf8");

    try {
      const artifacts = await fetchJson(`http://127.0.0.1:${port}/api/release/artifacts`);
      assert.ok(artifacts.total >= 1);
      assert.ok(artifacts.artifacts.some((item) => item.name.endsWith(".msi")));

      const draft = await fetchJson(`http://127.0.0.1:${port}/api/release/draft`);
      assert.match(draft.title, /CodexMaMi v/);
      assert.match(draft.body, /Installer Artifacts/);
      assert.match(draft.body, /CodexMaMi_0.1.0_x64_en-US\.msi/);
    } finally {
      await fs.rm(path.join(root, "src-tauri", "target"), { recursive: true, force: true });
    }
  });
});

async function withServer(assertions) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codexmami-"));
  const codexHome = path.join(temp, ".codex");
  const appHome = path.join(temp, ".codexmami");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), [
    'model_provider = "custom"',
    'model = "gpt-test"',
    "",
    "[mcp_servers.demo.env]",
    'API_KEY = "sk-secret-value"'
  ].join("\n"), "utf8");

  const previousEnv = {
    PORT: process.env.PORT,
    CODEX_HOME: process.env.CODEX_HOME,
    CODEXMAMI_HOME: process.env.CODEXMAMI_HOME
  };
  delete process.env.PORT;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEXMAMI_HOME = appHome;
  const { startServer } = await import(`file://${path.join(root, "server.mjs").replaceAll("\\", "/")}?case=${Date.now()}`);
  const server = await startServer({ port: 0 });
  const port = server.address().port;

  try {
    await assertions({ port, codexHome, appHome });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  assert.equal(response.ok, true);
  return response.json();
}
