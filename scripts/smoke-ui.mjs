import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codexmami-ui-"));
const codexHome = path.join(temp, ".codex");
const appHome = path.join(temp, ".codexmami");

await fs.mkdir(codexHome, { recursive: true });
await fs.writeFile(path.join(codexHome, "config.toml"), [
  'model_provider = "custom"',
  'model = "gpt-ui"',
  "",
  "[mcp_servers.demo]",
  'command = "demo.exe"',
  "enabled = true"
].join("\n"), "utf8");

delete process.env.PORT;
process.env.CODEX_HOME = codexHome;
process.env.CODEXMAMI_HOME = appHome;

const { startServer } = await import(`file://${path.join(root, "server.mjs").replaceAll("\\", "/")}?smoke=${Date.now()}`);
const server = await startServer({ port: 0 });
const port = server.address().port;

try {
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assertIncludes(html, "CodexMaMi");
  assertIncludes(html, "view-dashboard");
  assertIncludes(html, "模型路由");
  assertIncludes(html, "release-draft-body");
  assertIncludes(html, "account-editor");
  assertIncludes(html, "session-status-filter");
  assertIncludes(html, "run-publish-safety-btn");

  const app = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  assertIncludes(app, "refreshAll");
  assertIncludes(app, "applyRoute");
  assertIncludes(app, "saveAccountMetadata");
  assertIncludes(app, "runPublishSafety");
  assertIncludes(app, "testMcp");

  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  if (!health.ok || !health.configExists) {
    throw new Error("Health API did not report expected status.");
  }

  console.log(`UI smoke passed at http://127.0.0.1:${port}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected content to include ${expected}`);
  }
}
