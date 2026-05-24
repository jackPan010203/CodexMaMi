import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const homeDir = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(homeDir, ".codex");
const appHome = process.env.CODEXMAMI_HOME || path.join(homeDir, ".codexmami");
const configPath = path.join(codexHome, "config.toml");
const dataPath = path.join(appHome, "data.json");
const backupsDir = path.join(appHome, "backups");
const exportsDir = path.join(appHome, "exports");
const skillsDir = path.join(codexHome, "skills");
const skillBackupsDir = path.join(appHome, "skill-backups");
const releasesMetaPath = path.join(appHome, "release-channel.json");
const releaseArtifactsDir = path.join(__dirname, "src-tauri", "target", "release", "bundle");
const execFileAsync = promisify(execFile);
const allowedViews = new Set(["dashboard", "accounts", "sessions", "providers", "mcp", "skills", "backups", "maintenance", "settings"]);
const allowedAccountLifecycles = new Set(["active", "paused", "expired", "unknown"]);
const releaseArtifactExtensions = new Set([".exe", ".msi", ".msix", ".zip"]);
const secretContentPattern = /(sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=]\s*["']?[^"'\s]{8,}|authorization\s*[:=]\s*["']?bearer\s+[^"'\s]{8,}|AWESUN_API_TOKEN\s*=|OPENAI_API_KEY\s*=)/i;
const publishRiskNames = new Set([
  ".codexmami-dev",
  ".codexmami",
  "data.json",
  "config.toml",
  "auth.json",
  "credentials.json",
  "account-bundle.json",
  "backup.json"
]);
const publishRiskDirs = new Set(["backups", "exports", "skill-backups", "target", "node_modules"]);
const packageMeta = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  } catch {
    return {};
  }
})();

const defaultData = {
  version: 1,
  accounts: [],
  providers: [],
  threadState: {
    favorites: [],
    archived: []
  },
  preferences: {
    activeView: "dashboard",
    startView: "dashboard",
    autoRefreshSec: 0,
    groupSessionsByProject: true,
    showArchivedSessions: false,
    releaseLatestVersion: "",
    releaseLatestNotes: "",
    releaseGithubRepo: "",
    releaseApiBaseUrl: ""
  }
};

const secretKeyPattern = /(token|secret|api[_-]?key|apikey|authorization|password|credential)/i;
const secretLinePattern = /^(\s*[\w.-]*(?:token|secret|api[_-]?key|apikey|authorization|password|credential)[\w.-]*\s*=\s*)(["']?)(.*?)(\2)(\s*)$/i;

async function ensureAppDirs() {
  await fs.mkdir(appHome, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });
  await fs.mkdir(skillBackupsDir, { recursive: true });
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function errorResponse(res, status, message, detail = undefined) {
  jsonResponse(res, status, { error: message, detail });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    const size = chunks.reduce((sum, part) => sum + part.length, 0);
    if (size > 10 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function readData() {
  await ensureAppDirs();
  try {
    const raw = await fs.readFile(dataPath, "utf8");
    return mergeData(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeData(defaultData);
      return structuredClone(defaultData);
    }
    throw error;
  }
}

async function writeData(data) {
  await ensureAppDirs();
  const payload = JSON.stringify(mergeData(data), null, 2);
  await fs.writeFile(dataPath, payload, "utf8");
}

function mergeData(data) {
  return {
    ...structuredClone(defaultData),
    ...data,
    threadState: {
      ...defaultData.threadState,
      ...(data?.threadState || {})
    },
    preferences: {
      ...defaultData.preferences,
      ...(data?.preferences || {})
    }
  };
}

function maskSecret(value) {
  if (value == null || value === "") return "";
  const text = String(value);
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function maskToml(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(secretLinePattern, (_match, prefix, quote1, value, quote2, suffix) => {
      return `${prefix}${quote1}${maskSecret(value)}${quote2}${suffix}`;
    }))
    .join("\n");
}

function maskObject(value) {
  if (Array.isArray(value)) return value.map(maskObject);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      next[key] = maskSecret(item);
    } else {
      next[key] = maskObject(item);
    }
  }
  return next;
}

function parsePrimitive(raw) {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1)
      .split(",")
      .map((item) => parsePrimitive(item))
      .filter((item) => item !== "");
  }
  return trimmed;
}

function stripTomlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlSubset(text) {
  const root = {};
  let currentPath = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      currentPath = splitTomlPath(line.slice(1, -1));
      ensureNested(root, currentPath);
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = parsePrimitive(line.slice(equalsIndex + 1));
    const target = ensureNested(root, currentPath);
    target[unquoteKey(key)] = value;
  }
  return root;
}

function splitTomlPath(section) {
  const parts = [];
  let buffer = "";
  let quote = null;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index];
    if ((char === "\"" || char === "'") && section[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
      buffer += char;
      continue;
    }
    if (char === "." && !quote) {
      parts.push(unquoteKey(buffer.trim()));
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) parts.push(unquoteKey(buffer.trim()));
  return parts;
}

function unquoteKey(key) {
  const trimmed = key.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function ensureNested(root, parts) {
  let current = root;
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  return current;
}

async function readCodexConfig() {
  const exists = await fileExists(configPath);
  const raw = exists ? await fs.readFile(configPath, "utf8") : "";
  const parsed = exists ? parseTomlSubset(raw) : {};
  return {
    exists,
    path: configPath,
    codexHome,
    appHome,
    raw,
    masked: maskToml(raw),
    parsed,
    maskedParsed: maskObject(parsed)
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function createConfigBackup(reason) {
  await ensureAppDirs();
  const exists = await fileExists(configPath);
  if (!exists) {
    throw new Error(`Codex config not found at ${configPath}`);
  }
  const id = `${timestamp()}-${slugify(reason || "manual")}`;
  const target = path.join(backupsDir, `${id}.toml`);
  await fs.copyFile(configPath, target);
  const metaPath = path.join(backupsDir, `${id}.json`);
  const raw = await fs.readFile(configPath, "utf8");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await fs.writeFile(metaPath, JSON.stringify({
    id,
    reason,
    source: configPath,
    target,
    createdAt: new Date().toISOString(),
    sha256: hash
  }, null, 2), "utf8");
  return { id, path: target, createdAt: new Date().toISOString(), reason, sha256: hash };
}

async function listBackups() {
  await ensureAppDirs();
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    const id = entry.name.slice(0, -5);
    const filePath = path.join(backupsDir, entry.name);
    const stat = await fs.stat(filePath);
    const metaRaw = await readTextIfExists(path.join(backupsDir, `${id}.json`));
    const meta = metaRaw ? safeJson(metaRaw, {}) : {};
    backups.push({
      id,
      path: filePath,
      size: stat.size,
      createdAt: meta.createdAt || stat.mtime.toISOString(),
      reason: meta.reason || "backup",
      sha256: meta.sha256 || ""
    });
  }
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return backups;
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function slugify(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function id(prefix = "item") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function projectNameFromPath(value) {
  if (!value) return "未分类项目";
  const normalized = String(value).replace(/[\\/]+$/, "");
  const base = path.basename(normalized);
  return base || normalized || "未分类项目";
}

function normalizePreferences(input = {}) {
  const activeView = allowedViews.has(input.activeView) ? input.activeView : defaultData.preferences.activeView;
  const startView = allowedViews.has(input.startView) ? input.startView : defaultData.preferences.startView;
  const autoRefreshSec = Number.isFinite(Number(input.autoRefreshSec))
    ? Math.max(0, Math.min(300, Math.round(Number(input.autoRefreshSec))))
    : defaultData.preferences.autoRefreshSec;
  return {
    activeView,
    startView,
    autoRefreshSec,
    groupSessionsByProject: input.groupSessionsByProject !== false,
    showArchivedSessions: input.showArchivedSessions === true,
    releaseLatestVersion: String(input.releaseLatestVersion || "").trim(),
    releaseLatestNotes: String(input.releaseLatestNotes || "").trim(),
    releaseGithubRepo: String(input.releaseGithubRepo || "").trim(),
    releaseApiBaseUrl: String(input.releaseApiBaseUrl || "").trim()
  };
}

function currentVersion() {
  return String(packageMeta.version || "0.1.0");
}

function numberOrDefault(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAccountLifecycle(value) {
  const lifecycle = String(value || "").trim().toLowerCase();
  return allowedAccountLifecycles.has(lifecycle) ? lifecycle : "unknown";
}

function compareVersions(a, b) {
  const left = String(a || "").split(".").map((item) => Number(item) || 0);
  const right = String(b || "").split(".").map((item) => Number(item) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function exportAccountBundle(account) {
  const normalized = normalizeAccountRecord(account, account);
  return {
    schema: "codexmami-account-bundle@1",
    exportedAt: new Date().toISOString(),
    account: {
      id: normalized.id,
      name: normalized.name,
      note: normalized.note,
      ownerLabel: normalized.ownerLabel,
      planName: normalized.planName,
      lifecycle: normalized.lifecycle,
      renewalDate: normalized.renewalDate,
      quotaResetDate: normalized.quotaResetDate,
      quotaUsed: normalized.quotaUsed,
      quotaLimit: normalized.quotaLimit,
      quotaUnit: normalized.quotaUnit,
      privateNote: normalized.privateNote,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      summary: normalized.summary,
      configRaw: normalized.configRaw || ""
    }
  };
}

function importAccountBundle(input) {
  if (!input || input.schema !== "codexmami-account-bundle@1") {
    throw new Error("Unsupported account bundle format.");
  }
  const account = input.account || {};
  if (!account.name || !String(account.configRaw || "").trim()) {
    throw new Error("Account bundle is missing required fields.");
  }
  return normalizeAccountRecord({
    ...account,
    id: id("acct"),
    updatedAt: new Date().toISOString(),
    status: account.status || "ready",
    statusSource: account.statusSource || "import"
  });
}

function normalizeAccountRecord(input = {}, fallback = {}) {
  const configRaw = String(input.configRaw ?? fallback.configRaw ?? "");
  const name = String(input.name ?? fallback.name ?? "").trim();
  const createdAt = input.createdAt || fallback.createdAt || new Date().toISOString();
  const updatedAt = input.updatedAt || fallback.updatedAt || new Date().toISOString();
  const summary = input.summary || fallback.summary || summarizeConfig(parseTomlSubset(configRaw));
  return {
    id: input.id || fallback.id || id("acct"),
    name: name || `Codex profile ${new Date().toLocaleString()}`,
    note: String(input.note ?? fallback.note ?? ""),
    ownerLabel: String(input.ownerLabel ?? fallback.ownerLabel ?? ""),
    planName: String(input.planName ?? fallback.planName ?? ""),
    lifecycle: normalizeAccountLifecycle(input.lifecycle ?? fallback.lifecycle ?? "unknown"),
    renewalDate: String(input.renewalDate ?? fallback.renewalDate ?? ""),
    quotaResetDate: String(input.quotaResetDate ?? fallback.quotaResetDate ?? ""),
    privateNote: String(input.privateNote ?? fallback.privateNote ?? ""),
    createdAt,
    updatedAt,
    configRaw,
    summary,
    status: String(input.status ?? fallback.status ?? "unknown"),
    quotaUsed: numberOrDefault(input.quotaUsed ?? fallback.quotaUsed ?? 0, 0),
    quotaLimit: numberOrDefault(input.quotaLimit ?? fallback.quotaLimit ?? 0, 0),
    quotaUnit: String(input.quotaUnit ?? fallback.quotaUnit ?? "tokens"),
    lastCheckedAt: String(input.lastCheckedAt ?? fallback.lastCheckedAt ?? ""),
    statusNote: String(input.statusNote ?? fallback.statusNote ?? ""),
    statusSource: String(input.statusSource ?? fallback.statusSource ?? "local")
  };
}

function accountUsageInfo(account) {
  const quotaLimit = numberOrDefault(account.quotaLimit, 0);
  const quotaUsed = numberOrDefault(account.quotaUsed, 0);
  return {
    status: account.status || "unknown",
    statusSource: String(account.statusSource || "local"),
    lifecycle: normalizeAccountLifecycle(account.lifecycle),
    quotaUsed,
    quotaLimit,
    quotaRemaining: quotaLimit > 0 ? Math.max(0, quotaLimit - quotaUsed) : null,
    quotaUnit: String(account.quotaUnit || "tokens"),
    lastCheckedAt: account.lastCheckedAt || "",
    statusNote: String(account.statusNote || ""),
    ownerLabel: String(account.ownerLabel || ""),
    planName: String(account.planName || ""),
    renewalDate: String(account.renewalDate || ""),
    quotaResetDate: String(account.quotaResetDate || ""),
    privateNote: String(account.privateNote || "")
  };
}

function renderRouteConfig(currentRaw, provider) {
  const cleaned = removeManagedRoutingBlock(currentRaw);
  const proxyBase = `http://127.0.0.1:${process.env.PORT || "4173"}/proxy/${provider.id}/v1`;
  const block = [
    "",
    "# BEGIN CODEXMAMI ROUTING",
    'model_provider = "codexmami"',
    provider.defaultModel ? `model = "${escapeToml(provider.defaultModel)}"` : "",
    "",
    "[model_providers.codexmami]",
    `name = "${escapeToml(provider.name)} via CodexMaMi"`,
    `base_url = "${escapeToml(proxyBase)}"`,
    provider.defaultModel ? `model = "${escapeToml(provider.defaultModel)}"` : "",
    "# END CODEXMAMI ROUTING",
    ""
  ].filter((line) => line !== "").join("\n");
  return `${cleaned.trimEnd()}\n${block}`;
}

function removeManagedRoutingBlock(raw) {
  return raw.replace(/\n?# BEGIN CODEXMAMI ROUTING[\s\S]*?# END CODEXMAMI ROUTING\n?/g, "\n");
}

function renderMcpConfig(currentRaw, server) {
  const cleaned = removeMcpServerBlock(currentRaw, server.name).trimEnd();
  const lines = [
    "",
    `[mcp_servers.${tomlKey(server.name)}]`,
    `command = ${tomlString(server.command)}`,
    server.cwd ? `cwd = ${tomlString(server.cwd)}` : "",
    `enabled = ${server.enabled ? "true" : "false"}`
  ].filter(Boolean);

  if (server.args.length) {
    lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
  }

  if (Object.keys(server.env).length) {
    lines.push("", `[mcp_servers.${tomlKey(server.name)}.env]`);
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }

  return `${cleaned}\n${lines.join("\n")}\n`;
}

function removeMcpServerBlock(currentRaw, serverName) {
  const lines = currentRaw.split(/\r?\n/);
  const output = [];
  let skipping = false;
  for (const line of lines) {
    const section = line.trim().match(/^\[(.+)\]$/)?.[1];
    if (section) {
      const parts = splitTomlPath(section);
      skipping = parts[0] === "mcp_servers" && parts[1] === serverName;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function normalizeMcpServer(input) {
  const name = String(input.name || "").trim();
  const command = String(input.command || "").trim();
  if (!name) throw new Error("MCP server name is required.");
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("MCP server name can only contain letters, numbers, dot, underscore, and hyphen.");
  }
  if (!command) throw new Error("MCP command is required.");
  return {
    name,
    command,
    cwd: String(input.cwd || "").trim(),
    args: Array.isArray(input.args)
      ? input.args.map(String).map((item) => item.trim()).filter(Boolean)
      : String(input.args || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    env: parseEnvInput(input.env),
    enabled: input.enabled !== false
  };
}

async function testMcpServer(serverName) {
  const config = await readCodexConfig();
  const raw = config.parsed.mcp_servers?.[serverName];
  if (!raw) throw new Error("MCP server not found.");
  const server = normalizeMcpServer({ name: serverName, ...raw });
  const commandCheck = await resolveCommandCheck(server.command);
  if (!commandCheck.ok) {
    return {
      ok: false,
      name: serverName,
      stage: "command",
      command: server.command,
      detail: commandCheck.detail
    };
  }
  if (server.cwd && !(await fileExists(server.cwd))) {
    return {
      ok: false,
      name: serverName,
      stage: "cwd",
      command: server.command,
      detail: `Working directory not found: ${server.cwd}`
    };
  }
  const launch = await probeMcpLaunch(server);
  return {
    ok: launch.ok,
    name: serverName,
    stage: launch.stage,
    command: server.command,
    detail: launch.detail,
    stdout: launch.stdout,
    stderr: launch.stderr
  };
}

async function resolveCommandCheck(command) {
  if (!command) return { ok: false, detail: "Command is empty." };
  if (command.includes("\\") || command.includes("/") || path.isAbsolute(command)) {
    return { ok: await fileExists(command), detail: command };
  }
  try {
    const lookupCommand = os.platform() === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(lookupCommand, [command], { timeout: 5000 });
    return { ok: true, detail: stdout.trim().split(/\r?\n/)[0] || command };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

async function probeMcpLaunch(server) {
  try {
    const options = {
      cwd: server.cwd || undefined,
      env: { ...process.env, ...server.env },
      timeout: 2500,
      windowsHide: true,
      maxBuffer: 128 * 1024
    };
    const helpArgs = server.args.includes("--help") || server.args.includes("-h") ? server.args : [...server.args, "--help"];
    const { stdout, stderr } = await execFileAsync(server.command, helpArgs, options);
    return {
      ok: true,
      stage: "launch",
      detail: "Command started and returned successfully with --help probe.",
      stdout: maskToml(String(stdout || "").slice(0, 2000)),
      stderr: maskToml(String(stderr || "").slice(0, 2000))
    };
  } catch (error) {
    const stdout = maskToml(String(error.stdout || "").slice(0, 2000));
    const stderr = maskToml(String(error.stderr || "").slice(0, 2000));
    const timedOut = /timed out|ETIMEDOUT|timeout/i.test(error.message);
    return {
      ok: timedOut,
      stage: "launch",
      detail: timedOut ? "Command started but did not exit quickly; this often means a stdio MCP server is waiting for input." : error.message,
      stdout,
      stderr
    };
  }
}

function parseEnvInput(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.trim(), String(item)]).filter(([key]) => key));
  }
  const env = {};
  for (const line of String(value).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) throw new Error(`Invalid env line: ${trimmed}`);
    const key = trimmed.slice(0, index).trim();
    const item = trimmed.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
    env[key] = item;
  }
  return env;
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlString(value) {
  return `"${escapeToml(value)}"`;
}

function escapeToml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function diffLines(before, after) {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const max = Math.max(oldLines.length, newLines.length);
  const output = [];
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) output.push(`  ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) output.push(`- ${oldLine}`);
    if (newLine !== undefined) output.push(`+ ${newLine}`);
  }
  return output.join("\n");
}

function summarizeConfig(parsed) {
  const providers = Object.keys(parsed.model_providers || {});
  const mcpServers = Object.keys(parsed.mcp_servers || {});
  const projects = Object.keys(parsed.projects || {});
  return {
    model: parsed.model || "",
    modelProvider: parsed.model_provider || "",
    reasoningEffort: parsed.model_reasoning_effort || "",
    approvalPolicy: parsed.approval_policy || "",
    providers,
    mcpServers,
    projectsCount: projects.length
  };
}

function accountFromConfig(name, note, config) {
  const parsed = config.parsed;
  return normalizeAccountRecord({
    name: name || `Codex profile ${new Date().toLocaleString()}`,
    note: note || "",
    configRaw: config.raw,
    summary: summarizeConfig(parsed),
    status: config.exists ? "ready" : "missing-config",
    statusSource: "capture",
    lifecycle: "active",
    quotaUsed: 0,
    quotaLimit: 0,
    quotaUnit: "tokens",
    lastCheckedAt: "",
    statusNote: ""
  });
}

function accountPublic(account) {
  const normalized = normalizeAccountRecord(account, account);
  return {
    ...normalized,
    configRaw: undefined,
    maskedConfig: maskToml(normalized.configRaw || ""),
    usage: accountUsageInfo(normalized)
  };
}

async function scanSessions(data) {
  const roots = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions")
  ];
  const files = [];
  for (const root of roots) {
    await collectFiles(root, files, [".jsonl", ".json", ".md"]);
  }
  const favorites = new Set(data.threadState.favorites || []);
  const archived = new Set(data.threadState.archived || []);
  const sessions = [];
  for (const file of files) {
    const stat = await fs.stat(file);
    const text = await readPreview(file, 160_000);
    const session = parseSessionFile(file, text, stat, favorites, archived);
    sessions.push(session);
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

async function collectFiles(root, output, extensions) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath, output, extensions);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        output.push(fullPath);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readPreview(file, maxBytes) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.slice(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function parseSessionFile(file, text, stat, favorites, archived) {
  const stableId = crypto.createHash("sha1").update(file).digest("hex");
  let title = path.basename(file);
  let cwd = "";
  let threadId = "";
  let firstUserMessage = "";
  let messageCount = 0;
  const snippets = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = safeJson(line, null);
    if (!item) continue;
    if (!threadId && item.session_meta?.payload?.id) threadId = item.session_meta.payload.id;
    if (!cwd && item.cwd) cwd = item.cwd;
    if (!cwd && item.payload?.cwd) cwd = item.payload.cwd;
    if (!cwd && item.turn_context?.cwd) cwd = item.turn_context.cwd;
    const content = extractText(item);
    if (content) {
      messageCount += 1;
      if (!firstUserMessage && /user|human/i.test(item.role || item.type || item.payload?.role || "")) {
        firstUserMessage = content;
      }
      if (snippets.length < 4) snippets.push(content);
    }
  }

  if (firstUserMessage) {
    title = firstUserMessage.slice(0, 90);
  } else if (snippets[0]) {
    title = snippets[0].slice(0, 90);
  }

  return {
    id: stableId,
    threadId,
    title,
    path: file,
    cwd,
    projectName: projectNameFromPath(cwd),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    messageCount,
    preview: snippets.join("\n\n").slice(0, 600),
    favorite: favorites.has(stableId),
    archived: archived.has(stableId)
  };
}

function extractText(item) {
  const candidates = [
    item.content,
    item.text,
    item.message,
    item.payload?.content,
    item.payload?.text,
    item.payload?.message,
    item.event_msg,
    item.response_item?.content
  ];
  for (const candidate of candidates) {
    const text = normalizeContent(candidate);
    if (text) return text;
  }
  return "";
}

function normalizeContent(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(normalizeContent).filter(Boolean).join(" ").trim();
  }
  if (typeof value === "object") {
    return normalizeContent(value.text || value.content || value.value || value.message);
  }
  return "";
}

async function exportSession(sessionId) {
  const data = await readData();
  const sessions = await scanSessions(data);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("Session not found.");
  const raw = await fs.readFile(session.path, "utf8");
  const lines = [`# ${session.title}`, "", `- Source: ${session.path}`, `- Updated: ${session.updatedAt}`, ""];
  for (const line of raw.split(/\r?\n/)) {
    const item = safeJson(line, null);
    const text = item ? extractText(item) : "";
    if (!text) continue;
    const role = item.role || item.type || item.payload?.role || "event";
    lines.push(`## ${role}`, "", text, "");
  }
  await fs.mkdir(exportsDir, { recursive: true });
  const target = path.join(exportsDir, `${timestamp()}-${session.id}.md`);
  await fs.writeFile(target, lines.join("\n"), "utf8");
  return { path: target };
}

async function exportSessionSummary(sessionId) {
  const data = await readData();
  const sessions = await scanSessions(data);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("Session not found.");
  const lines = [
    `# ${session.title}`,
    "",
    `- Source: ${session.path}`,
    `- Project: ${session.projectName}`,
    `- CWD: ${session.cwd || "unknown"}`,
    `- Updated: ${session.updatedAt}`,
    `- Messages scanned: ${session.messageCount}`,
    `- Status: ${session.favorite ? "favorite" : "normal"}${session.archived ? ", archived" : ""}`,
    "",
    "## Preview",
    "",
    session.preview || "No preview text was found."
  ];
  await fs.mkdir(exportsDir, { recursive: true });
  const target = path.join(exportsDir, `${timestamp()}-${session.id}-summary.md`);
  await fs.writeFile(target, lines.join("\n"), "utf8");
  return { path: target, summary: lines.join("\n") };
}

async function getSessionPublic(sessionId) {
  const data = await readData();
  const sessions = await scanSessions(data);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("Session not found.");
  return session;
}

async function diagnoseSystem() {
  const config = await readCodexConfig();
  const data = await readData();
  const [backups, sessions, skills, processes] = await Promise.all([
    listBackups(),
    scanSessions(data),
    listSkills(),
    listCodexProcesses()
  ]);
  return {
    ok: config.exists,
    generatedAt: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    paths: {
      codexHome,
      appHome,
      configPath,
      backupsDir,
      exportsDir
    },
    checks: [
      checkItem("Codex 主目录", config.exists || await fileExists(codexHome), codexHome),
      checkItem("config.toml", config.exists, configPath),
      checkItem("CodexMaMi 数据目录", await fileExists(appHome), appHome),
      checkItem("备份目录", await fileExists(backupsDir), backupsDir),
      checkItem("导出目录", await fileExists(exportsDir), exportsDir)
    ],
    counts: {
      accounts: data.accounts.length,
      providers: data.providers.length,
      sessions: sessions.length,
      backups: backups.length,
      mcp: Object.keys(config.parsed.mcp_servers || {}).length,
      skills: skills.length
    },
    managedRouteEnabled: config.raw.includes("BEGIN CODEXMAMI ROUTING"),
    codexProcesses: processes
  };
}

function checkItem(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

async function listCodexProcesses() {
  if (os.platform() !== "win32") return [];
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], { timeout: 5000 });
    return stdout.split(/\r?\n/)
      .map((line) => parseCsvLine(line))
      .filter((row) => row.length >= 2)
      .filter((row) => row[0].toLowerCase().includes("codex"))
      .map((row) => ({ image: row[0], pid: row[1], memory: row[4] || "" }));
  } catch (error) {
    return [{ image: "tasklist unavailable", pid: "", memory: error.message }];
  }
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell) cells.push(cell);
  return cells;
}

async function listCleanupTargets() {
  await ensureAppDirs();
  const targets = [];
  await collectCleanupFiles(exportsDir, targets);
  return targets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function collectCleanupFiles(root, targets) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await collectCleanupFiles(fullPath, targets);
      } else if (entry.isFile()) {
        assertInside(fullPath, exportsDir);
        const stat = await fs.stat(fullPath);
        targets.push({
          path: fullPath,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          kind: "session-export"
        });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertInside(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside ${root}: ${target}`);
  }
}

async function cleanupAppExports(targetPaths) {
  const targets = await listCleanupTargets();
  const wanted = new Set((targetPaths || targets.map((item) => item.path)).map((item) => path.resolve(item)));
  const deleted = [];
  for (const target of targets) {
    if (!wanted.has(path.resolve(target.path))) continue;
    assertInside(target.path, exportsDir);
    await fs.rm(target.path, { force: true });
    deleted.push(target);
  }
  return deleted;
}

async function scanPublishSafety() {
  const checks = [];
  const findings = [];
  const gitignorePath = path.join(__dirname, ".gitignore");
  const gitignore = await readTextIfExists(gitignorePath);
  const requiredIgnores = [".codexmami-dev", ".codexmami", "*.account-bundle.json", "src-tauri/target", "node_modules"];
  for (const item of requiredIgnores) {
    checks.push(checkItem(`.gitignore includes ${item}`, gitignore.includes(item), gitignorePath));
  }
  await collectPublishRisks(__dirname, findings, __dirname, 0);
  const secretCount = findings.filter((item) => item.severity === "high").length;
  checks.push(checkItem("No obvious secrets in source tree", secretCount === 0, `${secretCount} high risk finding(s)`));
  return {
    ok: findings.every((item) => item.severity !== "high") && checks.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    root: __dirname,
    checks,
    findings: findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)).slice(0, 80)
  };
}

async function collectPublishRisks(root, findings, base, depth) {
  if (depth > 6) return;
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const relative = path.relative(base, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      if (publishRiskDirs.has(entry.name) || publishRiskNames.has(entry.name)) {
        findings.push({
          severity: entry.name === "node_modules" || entry.name === "target" ? "medium" : "high",
          kind: "directory",
          path: fullPath,
          message: `${relative} should not be published unless intentionally sanitized.`
        });
      }
      if (entry.name === "node_modules" || entry.name === "target") continue;
      await collectPublishRisks(fullPath, findings, base, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const lowerName = entry.name.toLowerCase();
    if (publishRiskNames.has(lowerName) || lowerName.endsWith(".account-bundle.json") || lowerName.endsWith(".toml.bak")) {
      findings.push({
        severity: "high",
        kind: "file",
        path: fullPath,
        message: `${relative} looks like local config, account, or backup data.`
      });
    }
    const stat = await fs.stat(fullPath);
    if (stat.size > 512 * 1024) continue;
    const ext = path.extname(lowerName);
    if (![".js", ".mjs", ".json", ".toml", ".md", ".ps1", ".html", ".css", ".env", ""].includes(ext)) continue;
    const text = await readTextIfExists(fullPath);
    if (secretContentPattern.test(text)) {
      findings.push({
        severity: "high",
        kind: "secret-pattern",
        path: fullPath,
        message: `${relative} contains text that looks like a token or API key.`
      });
    }
  }
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3 }[value] || 0;
}

async function createSkillsBackup(reason = "manual-skills") {
  await ensureAppDirs();
  const idValue = `${timestamp()}-${slugify(reason)}`;
  const targetDir = path.join(skillBackupsDir, idValue);
  await fs.mkdir(targetDir, { recursive: true });
  const entries = [];
  await collectLocalSkillDirs(skillsDir, entries);
  for (const entry of entries) {
    const relative = path.relative(skillsDir, entry);
    const destination = path.join(targetDir, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(entry, destination, { recursive: true, force: true });
  }
  const meta = {
    id: idValue,
    reason,
    createdAt: new Date().toISOString(),
    entries: entries.map((entry) => path.relative(skillsDir, entry))
  };
  await fs.writeFile(path.join(targetDir, "backup.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

async function listSkillBackups() {
  await ensureAppDirs();
  const entries = await fs.readdir(skillBackupsDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backupDir = path.join(skillBackupsDir, entry.name);
    const metaRaw = await readTextIfExists(path.join(backupDir, "backup.json"));
    const meta = safeJson(metaRaw, {});
    backups.push({
      id: entry.name,
      path: backupDir,
      createdAt: meta.createdAt || entry.name,
      reason: meta.reason || "skill-backup",
      entries: Array.isArray(meta.entries) ? meta.entries : []
    });
  }
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return backups;
}

async function runReleaseEnvironmentCheck() {
  const checks = [];
  const nodeCheck = await checkCommandVersion("node");
  const npmCheck = await checkCommandVersion("npm");
  const rustcCheck = await checkCommandVersion("rustc");
  const cargoCheck = await checkCommandVersion("cargo");
  checks.push(nodeCheck, npmCheck, rustcCheck, cargoCheck);
  checks.push({
    name: "Tauri config",
    ok: await fileExists(path.join(__dirname, "src-tauri", "tauri.conf.json")),
    detail: path.join(__dirname, "src-tauri", "tauri.conf.json")
  });
  const artifacts = await inspectReleaseArtifacts();
  checks.push({
    name: "Installer artifacts",
    ok: artifacts.total > 0,
    detail: artifacts.total > 0
      ? `${artifacts.total} artifact(s) found in ${artifacts.root}`
      : `No installer artifacts found in ${artifacts.root}`
  });
  return {
    ok: checks.every((item) => item.ok),
    checks,
    artifacts
  };
}

async function checkCommandVersion(name) {
  try {
    const command = name === "npm" && process.platform === "win32" ? `${name}.cmd` : name;
    const { stdout, stderr } = await execFileAsync(command, ["--version"], { timeout: 5000 });
    const detail = [stdout, stderr].join("\n").trim();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

async function fetchJsonUrl(urlValue, headers = {}) {
  const response = await fetch(urlValue, {
    headers: {
      "user-agent": "CodexMaMi",
      accept: "application/json",
      ...headers
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchGithubRelease(preferences) {
  const repo = preferences.releaseGithubRepo;
  if (!repo) {
    return {
      currentVersion: currentVersion(),
      latestVersion: preferences.releaseLatestVersion || "",
      hasUpdate: preferences.releaseLatestVersion ? compareVersions(preferences.releaseLatestVersion, currentVersion()) > 0 : false,
      latestNotes: preferences.releaseLatestNotes || "",
      releaseConfigured: Boolean(preferences.releaseLatestVersion),
      source: "local"
    };
  }
  const apiBase = preferences.releaseApiBaseUrl || "https://api.github.com";
  const payload = await fetchJsonUrl(`${apiBase.replace(/\/+$/, "")}/repos/${repo}/releases/latest`);
  const latestVersion = String(payload.tag_name || payload.name || "").replace(/^v/i, "");
  return {
    currentVersion: currentVersion(),
    latestVersion,
    hasUpdate: latestVersion ? compareVersions(latestVersion, currentVersion()) > 0 : false,
    latestNotes: String(payload.body || preferences.releaseLatestNotes || ""),
    releaseConfigured: true,
    source: "github",
    repo,
    url: payload.html_url || ""
  };
}

async function inspectReleaseArtifacts() {
  const artifacts = [];
  await collectReleaseArtifacts(releaseArtifactsDir, artifacts);
  artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    root: releaseArtifactsDir,
    exists: await fileExists(releaseArtifactsDir),
    total: artifacts.length,
    artifacts
  };
}

async function collectReleaseArtifacts(root, output) {
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectReleaseArtifacts(fullPath, output);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!releaseArtifactExtensions.has(ext)) continue;
    const stat = await fs.stat(fullPath);
    output.push({
      name: entry.name,
      type: ext.slice(1),
      path: fullPath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    });
  }
}

async function readReleaseNotesSource(preferences) {
  if (String(preferences.releaseLatestNotes || "").trim()) {
    return String(preferences.releaseLatestNotes || "").trim();
  }
  const changelogPath = path.join(__dirname, "CHANGELOG.md");
  const raw = await readTextIfExists(changelogPath);
  if (!raw.trim()) return "";
  const match = raw.match(/^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|\Z)/m);
  if (!match) return "";
  return match[2].trim();
}

function formatByteSize(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function buildReleaseDraft(preferences) {
  const [release, artifacts, changelog] = await Promise.all([
    fetchGithubRelease(preferences),
    inspectReleaseArtifacts(),
    readReleaseNotesSource(preferences)
  ]);
  const version = release.latestVersion || preferences.releaseLatestVersion || currentVersion();
  const notes = (preferences.releaseLatestNotes || changelog || "").trim();
  const artifactLines = artifacts.artifacts.length
    ? artifacts.artifacts.map((item) => `- ${item.name} (${formatByteSize(item.size)})`)
    : ["- No Windows installer artifact found yet."];
  return {
    version,
    title: `CodexMaMi v${version}`,
    body: [
      `# CodexMaMi ${version}`,
      "",
      "## Highlights",
      notes || "- Update notes not filled in yet.",
      "",
      "## Installer Artifacts",
      ...artifactLines,
      "",
      "## Notes",
      "- This release remains local-first and stores user data on the user's machine.",
      "- Secrets are masked in the UI; review your local app data before publishing."
    ].join("\n"),
    artifacts,
    release
  };
}

function updateAccountMetadata(account, input = {}) {
  return normalizeAccountRecord({
    ...account,
    name: String(input.name ?? account.name ?? "").trim() || account.name,
    note: String(input.note ?? account.note ?? ""),
    ownerLabel: String(input.ownerLabel ?? account.ownerLabel ?? ""),
    planName: String(input.planName ?? account.planName ?? ""),
    lifecycle: normalizeAccountLifecycle(input.lifecycle ?? account.lifecycle),
    renewalDate: String(input.renewalDate ?? account.renewalDate ?? ""),
    quotaResetDate: String(input.quotaResetDate ?? account.quotaResetDate ?? ""),
    quotaUsed: numberOrDefault(input.quotaUsed ?? account.quotaUsed ?? 0, 0),
    quotaLimit: numberOrDefault(input.quotaLimit ?? account.quotaLimit ?? 0, 0),
    quotaUnit: String(input.quotaUnit ?? account.quotaUnit ?? "tokens"),
    privateNote: String(input.privateNote ?? account.privateNote ?? ""),
    statusNote: String(input.statusNote ?? account.statusNote ?? ""),
    updatedAt: new Date().toISOString()
  }, account);
}

async function refreshAccountStatus(accountId) {
  const data = await readData();
  const index = data.accounts.findIndex((item) => item.id === accountId);
  if (index === -1) throw new Error("Account not found.");
  const account = normalizeAccountRecord(data.accounts[index], data.accounts[index]);
  const parsed = parseTomlSubset(account.configRaw || "");
  const hasProvider = Boolean(parsed.model_provider || parsed.model || Object.keys(parsed.model_providers || {}).length);
  const status = hasProvider ? "ready" : "incomplete";
  const updated = normalizeAccountRecord({
    ...account,
    status,
    lastCheckedAt: new Date().toISOString(),
    statusSource: "local-scan",
    statusNote: hasProvider ? "检测到模型或 provider 配置。" : "没有检测到可用模型或 provider 配置。",
    quotaUsed: numberOrDefault(account.quotaUsed, 0),
    quotaLimit: numberOrDefault(account.quotaLimit, 0),
    quotaUnit: account.quotaUnit || "tokens",
    updatedAt: new Date().toISOString()
  }, account);
  data.accounts[index] = updated;
  await writeData(data);
  return accountPublic(updated);
}

async function collectLocalSkillDirs(root, output) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const skillFile = path.join(fullPath, "SKILL.md");
        if (await fileExists(skillFile)) {
          output.push(fullPath);
        } else {
          await collectLocalSkillDirs(fullPath, output);
        }
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function resolveSkillDirectoryById(skillId) {
  const skills = await listSkills();
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) {
    throw new Error("Skill not found.");
  }
  const skillDir = path.dirname(skill.path);
  assertInside(skillDir, codexHome);
  return { skill, skillDir };
}

async function removeLocalSkill(skillId) {
  const { skill, skillDir } = await resolveSkillDirectoryById(skillId);
  assertInside(skillDir, skillsDir);
  const backup = await createSkillsBackup(`before-skill-remove-${skill.name}`);
  await fs.rm(skillDir, { recursive: true, force: true });
  return { removed: skill.name, backup };
}

async function importSkillBundle(payload) {
  const name = String(payload.name || "").trim();
  const content = String(payload.content || "");
  if (!name) throw new Error("Skill name is required.");
  if (!content.trim()) throw new Error("Skill content is required.");
  const slug = slugify(name);
  const targetDir = path.join(skillsDir, slug);
  assertInside(targetDir, skillsDir);
  const skillFile = path.join(targetDir, "SKILL.md");
  if (await fileExists(skillFile)) {
    throw new Error("A local skill with the same name already exists.");
  }
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(skillFile, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return { name, path: skillFile };
}

async function restoreSkillBackup(backupId) {
  const backups = await listSkillBackups();
  const backup = backups.find((item) => item.id === backupId);
  if (!backup) throw new Error("Skill backup not found.");
  await createSkillsBackup("before-skill-restore");
  const entries = await fs.readdir(backup.path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(backup.path, entry.name);
    const target = path.join(skillsDir, entry.name);
    assertInside(source, skillBackupsDir);
    assertInside(target, skillsDir);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(source, target, { recursive: true, force: true });
  }
  return backup;
}

async function listSkills() {
  const roots = [
    skillsDir,
    path.join(codexHome, "plugins", "cache"),
    path.join(codexHome, ".plugins", "cache")
  ];
  const found = [];
  for (const root of roots) {
    await collectSkillFiles(root, found);
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

async function collectSkillFiles(root, output) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        await collectSkillFiles(fullPath, output);
      } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        const text = await readPreview(fullPath, 32_000);
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const description = text.match(/description:\s*(.+)/i)?.[1]?.trim() || text.split(/\r?\n/).slice(0, 8).join(" ").slice(0, 180);
        output.push({
          id: crypto.createHash("sha1").update(fullPath).digest("hex"),
          name: title || path.basename(path.dirname(fullPath)),
          description,
          path: fullPath,
          source: fullPath.startsWith(skillsDir) ? "local" : "plugin-cache"
        });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const requested = path.normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, requested);
  if (!filePath.startsWith(publicDir)) {
    textResponse(res, 403, "Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      textResponse(res, 404, "Not found");
      return;
    }
    const contentType = contentTypeFor(filePath);
    res.writeHead(200, { "content-type": contentType });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      textResponse(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    const config = await readCodexConfig();
    const data = await readData();
    jsonResponse(res, 200, {
      ok: true,
      app: "CodexMaMi",
      version: currentVersion(),
      paths: { codexHome, appHome, configPath, releaseArtifactsDir },
      configExists: config.exists,
      accounts: data.accounts.length,
      providers: data.providers.length
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    const config = await readCodexConfig();
    jsonResponse(res, 200, {
      exists: config.exists,
      path: config.path,
      codexHome: config.codexHome,
      appHome: config.appHome,
      masked: config.masked,
      summary: summarizeConfig(config.parsed),
      parsed: config.maskedParsed
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/preferences") {
    const data = await readData();
    jsonResponse(res, 200, { preferences: normalizePreferences(data.preferences) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/preferences") {
    const body = await readJsonBody(req);
    const data = await readData();
    data.preferences = normalizePreferences({ ...data.preferences, ...body });
    await writeData(data);
    jsonResponse(res, 200, { ok: true, preferences: data.preferences });
    return;
  }

  if (req.method === "GET" && pathname === "/api/release/environment") {
    jsonResponse(res, 200, await runReleaseEnvironmentCheck());
    return;
  }

  if (req.method === "GET" && pathname === "/api/release/artifacts") {
    jsonResponse(res, 200, await inspectReleaseArtifacts());
    return;
  }

  if (req.method === "GET" && pathname === "/api/release/draft") {
    const data = await readData();
    const preferences = normalizePreferences(data.preferences);
    jsonResponse(res, 200, await buildReleaseDraft(preferences));
    return;
  }

  if (req.method === "GET" && pathname === "/api/paths") {
    jsonResponse(res, 200, {
      paths: {
        codexHome,
        configPath,
        appHome,
        backupsDir,
        exportsDir,
        skillsDir,
        skillBackupsDir,
        releaseArtifactsDir,
        releasesMetaPath
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/backups") {
    const body = await readJsonBody(req);
    const backup = await createConfigBackup(body.reason || "manual");
    jsonResponse(res, 201, backup);
    return;
  }

  if (req.method === "GET" && pathname === "/api/backups") {
    jsonResponse(res, 200, { backups: await listBackups() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/backups/restore") {
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Restore requires confirm: true.");
      return;
    }
    const backups = await listBackups();
    const backup = backups.find((item) => item.id === body.id);
    if (!backup) {
      errorResponse(res, 404, "Backup not found.");
      return;
    }
    await createConfigBackup("before-restore");
    await fs.copyFile(backup.path, configPath);
    jsonResponse(res, 200, { ok: true, restored: backup.id });
    return;
  }

  if (req.method === "GET" && pathname === "/api/accounts") {
    const data = await readData();
    jsonResponse(res, 200, { accounts: data.accounts.map(accountPublic) });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/accounts\/[^/]+\/status-refresh$/)) {
    const accountId = decodeURIComponent(pathname.split("/")[3]);
    jsonResponse(res, 200, { ok: true, account: await refreshAccountStatus(accountId) });
    return;
  }

  if (req.method === "PUT" && pathname.match(/^\/api\/accounts\/[^/]+$/)) {
    const accountId = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    const data = await readData();
    const index = data.accounts.findIndex((item) => item.id === accountId);
    if (index === -1) {
      errorResponse(res, 404, "Account not found.");
      return;
    }
    const updated = updateAccountMetadata(data.accounts[index], body);
    data.accounts[index] = updated;
    await writeData(data);
    jsonResponse(res, 200, { ok: true, account: accountPublic(updated) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/accounts/import") {
    const body = await readJsonBody(req);
    const account = importAccountBundle(body);
    const data = await readData();
    data.accounts.unshift(account);
    await writeData(data);
    jsonResponse(res, 201, { ok: true, account: accountPublic(account) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/accounts/capture") {
    const body = await readJsonBody(req);
    const config = await readCodexConfig();
    if (!config.exists) {
      errorResponse(res, 404, "Codex config not found.");
      return;
    }
    const data = await readData();
    const account = accountFromConfig(body.name, body.note, config);
    data.accounts.unshift(account);
    await writeData(data);
    jsonResponse(res, 201, { account: accountPublic(account) });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/accounts/")) {
    const accountId = decodeURIComponent(pathname.split("/").pop());
    const data = await readData();
    data.accounts = data.accounts.filter((account) => account.id !== accountId);
    await writeData(data);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/accounts\/[^/]+\/preview$/)) {
    const accountId = decodeURIComponent(pathname.split("/")[3]);
    const data = await readData();
    const account = data.accounts.find((item) => item.id === accountId);
    if (!account) {
      errorResponse(res, 404, "Account not found.");
      return;
    }
    const config = await readCodexConfig();
    jsonResponse(res, 200, {
      account: accountPublic(account),
      diff: diffLines(maskToml(config.raw), maskToml(account.configRaw || ""))
    });
    return;
  }

  if (req.method === "GET" && pathname.match(/^\/api\/accounts\/[^/]+\/export$/)) {
    const accountId = decodeURIComponent(pathname.split("/")[3]);
    const data = await readData();
    const account = data.accounts.find((item) => item.id === accountId);
    if (!account) {
      errorResponse(res, 404, "Account not found.");
      return;
    }
    jsonResponse(res, 200, exportAccountBundle(account));
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/accounts\/[^/]+\/apply$/)) {
    const accountId = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Account switch requires confirm: true.");
      return;
    }
    const data = await readData();
    const account = data.accounts.find((item) => item.id === accountId);
    if (!account) {
      errorResponse(res, 404, "Account not found.");
      return;
    }
    const backup = await createConfigBackup(`before-account-${account.name}`);
    await fs.writeFile(configPath, account.configRaw || "", "utf8");
    jsonResponse(res, 200, { ok: true, backup });
    return;
  }

  if (req.method === "GET" && pathname === "/api/sessions") {
    const data = await readData();
    const sessions = await scanSessions(data);
    const grouped = Object.values(sessions.reduce((map, session) => {
      const key = session.projectName || "未分类项目";
      if (!map[key]) {
        map[key] = {
          projectName: key,
          cwd: session.cwd || "",
          count: 0,
          latestUpdatedAt: session.updatedAt,
          sessions: []
        };
      }
      map[key].count += 1;
      map[key].latestUpdatedAt = map[key].latestUpdatedAt > session.updatedAt ? map[key].latestUpdatedAt : session.updatedAt;
      map[key].sessions.push(session);
      return map;
    }, {})).sort((a, b) => b.latestUpdatedAt.localeCompare(a.latestUpdatedAt));
    jsonResponse(res, 200, { sessions, grouped, preferences: normalizePreferences(data.preferences) });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/sessions\/[^/]+\/state$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    const data = await readData();
    for (const key of ["favorites", "archived"]) {
      const set = new Set(data.threadState[key] || []);
      if (body[key.slice(0, -1)] === true) set.add(sessionId);
      if (body[key.slice(0, -1)] === false) set.delete(sessionId);
      data.threadState[key] = [...set];
    }
    await writeData(data);
    jsonResponse(res, 200, { ok: true, threadState: data.threadState });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/sessions\/[^/]+\/export$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3]);
    const result = await exportSession(sessionId);
    jsonResponse(res, 200, result);
    return;
  }

  if (req.method === "GET" && pathname.match(/^\/api\/sessions\/[^/]+$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3]);
    jsonResponse(res, 200, { session: await getSessionPublic(sessionId) });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/sessions\/[^/]+\/summary-export$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3]);
    const result = await exportSessionSummary(sessionId);
    jsonResponse(res, 200, result);
    return;
  }

  if (req.method === "GET" && pathname === "/api/providers") {
    const data = await readData();
    jsonResponse(res, 200, { providers: data.providers.map(maskProvider) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/providers") {
    const body = await readJsonBody(req);
    const data = await readData();
    const provider = normalizeProvider(body);
    data.providers.unshift(provider);
    await writeData(data);
    jsonResponse(res, 201, { provider: maskProvider(provider) });
    return;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/providers/")) {
    const providerId = decodeURIComponent(pathname.split("/").pop());
    const body = await readJsonBody(req);
    const data = await readData();
    const index = data.providers.findIndex((provider) => provider.id === providerId);
    if (index === -1) {
      errorResponse(res, 404, "Provider not found.");
      return;
    }
    data.providers[index] = normalizeProvider({ ...data.providers[index], ...body, id: providerId });
    await writeData(data);
    jsonResponse(res, 200, { provider: maskProvider(data.providers[index]) });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/providers/")) {
    const providerId = decodeURIComponent(pathname.split("/").pop());
    const data = await readData();
    data.providers = data.providers.filter((provider) => provider.id !== providerId);
    await writeData(data);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/providers\/[^/]+\/test$/)) {
    const providerId = decodeURIComponent(pathname.split("/")[3]);
    const data = await readData();
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) {
      errorResponse(res, 404, "Provider not found.");
      return;
    }
    const result = await testProvider(provider);
    jsonResponse(res, result.ok ? 200 : 502, result);
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/providers\/[^/]+\/route-preview$/)) {
    const providerId = decodeURIComponent(pathname.split("/")[3]);
    const data = await readData();
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) {
      errorResponse(res, 404, "Provider not found.");
      return;
    }
    const config = await readCodexConfig();
    const next = renderRouteConfig(config.raw, provider);
    jsonResponse(res, 200, { provider: maskProvider(provider), diff: diffLines(maskToml(config.raw), maskToml(next)) });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/providers\/[^/]+\/apply-route$/)) {
    const providerId = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Route apply requires confirm: true.");
      return;
    }
    const data = await readData();
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) {
      errorResponse(res, 404, "Provider not found.");
      return;
    }
    const config = await readCodexConfig();
    const backup = await createConfigBackup(`before-route-${provider.name}`);
    await fs.writeFile(configPath, renderRouteConfig(config.raw, provider), "utf8");
    jsonResponse(res, 200, { ok: true, backup });
    return;
  }

  if (req.method === "POST" && pathname === "/api/routing/disable") {
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Disable route requires confirm: true.");
      return;
    }
    const config = await readCodexConfig();
    const backup = await createConfigBackup("before-disable-route");
    await fs.writeFile(configPath, removeManagedRoutingBlock(config.raw), "utf8");
    jsonResponse(res, 200, { ok: true, backup });
    return;
  }

  if (req.method === "GET" && pathname === "/api/mcp") {
    const config = await readCodexConfig();
    const servers = Object.entries(config.parsed.mcp_servers || {}).map(([name, value]) => ({
      name,
      ...maskObject(value),
      enabled: value.enabled !== false
    }));
    jsonResponse(res, 200, { servers });
    return;
  }

  if (req.method === "POST" && pathname === "/api/mcp/preview") {
    const body = await readJsonBody(req);
    const server = normalizeMcpServer(body);
    const config = await readCodexConfig();
    const next = renderMcpConfig(config.raw, server);
    jsonResponse(res, 200, {
      server: maskObject(server),
      diff: diffLines(maskToml(config.raw), maskToml(next))
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/mcp/apply") {
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "MCP apply requires confirm: true.");
      return;
    }
    const server = normalizeMcpServer(body);
    const config = await readCodexConfig();
    const backup = await createConfigBackup(`before-mcp-${server.name}`);
    await fs.writeFile(configPath, renderMcpConfig(config.raw, server), "utf8");
    jsonResponse(res, 200, { ok: true, backup });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/mcp\/[^/]+\/test$/)) {
    const serverName = decodeURIComponent(pathname.split("/")[3]);
    jsonResponse(res, 200, await testMcpServer(serverName));
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/mcp\/[^/]+\/delete-preview$/)) {
    const serverName = decodeURIComponent(pathname.split("/")[3]);
    const config = await readCodexConfig();
    const next = removeMcpServerBlock(config.raw, serverName);
    jsonResponse(res, 200, {
      name: serverName,
      diff: diffLines(maskToml(config.raw), maskToml(next))
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/mcp\/[^/]+\/delete$/)) {
    const serverName = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "MCP delete requires confirm: true.");
      return;
    }
    const config = await readCodexConfig();
    const backup = await createConfigBackup(`before-mcp-delete-${serverName}`);
    await fs.writeFile(configPath, removeMcpServerBlock(config.raw, serverName), "utf8");
    jsonResponse(res, 200, { ok: true, backup });
    return;
  }

  if (req.method === "GET" && pathname === "/api/skills") {
    const [skills, backups] = await Promise.all([listSkills(), listSkillBackups()]);
    jsonResponse(res, 200, { skills, backups });
    return;
  }

  if (req.method === "GET" && pathname === "/api/release/check") {
    const data = await readData();
    const preferences = normalizePreferences(data.preferences);
    jsonResponse(res, 200, await fetchGithubRelease(preferences));
    return;
  }

  if (req.method === "POST" && pathname === "/api/skills/import") {
    const body = await readJsonBody(req);
    const created = await importSkillBundle(body);
    jsonResponse(res, 201, { ok: true, created });
    return;
  }

  if (req.method === "POST" && pathname === "/api/skills/backups") {
    const body = await readJsonBody(req);
    const backup = await createSkillsBackup(body.reason || "manual-ui");
    jsonResponse(res, 201, { ok: true, backup });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/skills\/[^/]+\/delete$/)) {
    const skillId = decodeURIComponent(pathname.split("/")[3]);
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Skill delete requires confirm: true.");
      return;
    }
    const result = await removeLocalSkill(skillId);
    jsonResponse(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/skills\/backups\/[^/]+\/restore$/)) {
    const backupId = decodeURIComponent(pathname.split("/")[4]);
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Skill restore requires confirm: true.");
      return;
    }
    const restored = await restoreSkillBackup(backupId);
    jsonResponse(res, 200, { ok: true, restored });
    return;
  }

  if (req.method === "GET" && pathname === "/api/maintenance/diagnose") {
    jsonResponse(res, 200, await diagnoseSystem());
    return;
  }

  if (req.method === "GET" && pathname === "/api/maintenance/publish-safety") {
    jsonResponse(res, 200, await scanPublishSafety());
    return;
  }

  if (req.method === "GET" && pathname === "/api/maintenance/cleanup-targets") {
    jsonResponse(res, 200, { targets: await listCleanupTargets() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/maintenance/cleanup") {
    const body = await readJsonBody(req);
    if (!body.confirm) {
      errorResponse(res, 400, "Cleanup requires confirm: true.");
      return;
    }
    const deleted = await cleanupAppExports(body.paths);
    jsonResponse(res, 200, { ok: true, deleted });
    return;
  }

  errorResponse(res, 404, "API route not found.");
}

function normalizeProvider(input) {
  return {
    id: input.id || id("provider"),
    name: String(input.name || "Provider").trim(),
    baseUrl: String(input.baseUrl || input.base_url || "").trim().replace(/\/+$/, ""),
    apiKey: String(input.apiKey || input.api_key || ""),
    models: Array.isArray(input.models)
      ? input.models.map(String).map((item) => item.trim()).filter(Boolean)
      : String(input.models || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
    defaultModel: String(input.defaultModel || input.default_model || "").trim(),
    enabled: input.enabled !== false,
    note: String(input.note || ""),
    updatedAt: new Date().toISOString(),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function maskProvider(provider) {
  return {
    ...provider,
    apiKey: maskSecret(provider.apiKey),
    hasApiKey: Boolean(provider.apiKey)
  };
}

async function testProvider(provider) {
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      signal: AbortSignal.timeout(12_000)
    });
    const text = await response.text();
    const parsed = safeJson(text, null);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      models: Array.isArray(parsed?.data) ? parsed.data.map((item) => item.id).filter(Boolean).slice(0, 50) : [],
      message: response.ok ? "Provider responded." : text.slice(0, 500)
    };
  } catch (error) {
    return { ok: false, status: 0, message: error.message };
  }
}

async function handleProxy(req, res, url) {
  const parts = url.pathname.split("/");
  const providerId = decodeURIComponent(parts[2] || "");
  const suffix = `/${parts.slice(3).join("/")}${url.search || ""}`;
  const data = await readData();
  const provider = data.providers.find((item) => item.id === providerId && item.enabled);
  if (!provider) {
    errorResponse(res, 404, "Enabled provider not found.");
    return;
  }
  const upstreamUrl = new URL(`${provider.baseUrl.replace(/\/+$/, "")}${suffix}`);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await requestBuffer(req);
  const headers = { ...req.headers };
  delete headers.host;
  headers.authorization = `Bearer ${provider.apiKey}`;
  headers["x-codexmami-provider"] = provider.name;

  const transport = upstreamUrl.protocol === "https:" ? https : http;
  const upstreamReq = transport.request(upstreamUrl, {
    method: req.method,
    headers
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, {
      ...upstreamRes.headers,
      "x-codexmami-proxy": "true"
    });
    upstreamRes.pipe(res);
  });
  upstreamReq.on("error", (error) => {
    if (!res.headersSent) errorResponse(res, 502, "Proxy request failed.", error.message);
  });
  if (body) upstreamReq.write(body);
  upstreamReq.end();
}

async function requestBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/proxy/")) {
      await handleProxy(req, res, url);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    errorResponse(res, 500, "Internal server error.", error.message);
  }
}

export async function startServer(options = {}) {
  await ensureAppDirs();
  const requestedPort = options.port ?? process.env.PORT ?? 4173;
  const port = Number(requestedPort);
  const host = options.host || "127.0.0.1";
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  return server;
}

export const runtimePaths = {
  codexHome,
  appHome,
  configPath,
  dataPath,
  backupsDir,
  exportsDir
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer();
  const address = server.address();
  console.log(`CodexMaMi running at http://127.0.0.1:${address.port}`);
  console.log(`Codex home: ${codexHome}`);
  console.log(`App home: ${appHome}`);
}
