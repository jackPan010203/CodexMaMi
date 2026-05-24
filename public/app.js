const state = {
  view: "dashboard",
  health: null,
  config: null,
  preferences: null,
  paths: null,
  release: null,
  releaseEnvironment: null,
  releaseDraft: null,
  releaseArtifacts: null,
  accounts: [],
  sessions: [],
  sessionGroups: [],
  providers: [],
  backups: [],
  mcp: [],
  skills: [],
  skillBackups: [],
  diagnosis: null,
  publishSafety: null,
  cleanupTargets: [],
  selectedProvider: null,
  selectedAccountId: null,
  expandedProjects: new Set()
};

const titles = {
  dashboard: ["总览", "把配置、线程、路由和安全备份放在同一个清楚的工作台里。"],
  accounts: ["账号", "先保存当前配置，再决定是否切换，适合小白慢慢试。"],
  sessions: ["线程", "整理本机会话，不碰原始文件，搜索和归档会更安心。"],
  providers: ["模型路由", "先测试连通性，再决定是否写入 Codex。"],
  mcp: ["MCP", "添加、检查和移除 Codex 的扩展服务。"],
  skills: ["Skills", "把本机 skill 目录看清楚，方便后续做导入和备份。"],
  backups: ["备份", "每一次重要改动，都应该能回退。"],
  maintenance: ["维护", "先诊断，再处理本地运行问题。"],
  settings: ["设置", "知道边界、目录和当前状态，比盲点按钮更重要。"]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  }
  return payload;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function fmtDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fmtDateShort(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`;
  return `${Math.max(1, Math.round(diff / day))} 天前`;
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function setView(view) {
  state.view = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  const [title, subtitle] = titles[view];
  $("#view-title").textContent = title;
  $("#view-subtitle").textContent = subtitle;
}

function filteredSessions() {
  const query = $("#session-search")?.value.trim().toLowerCase() || "";
  const status = $("#session-status-filter")?.value || "active";
  const project = $("#session-project-filter")?.value || "";
  const showArchived = state.preferences?.showArchivedSessions === true;
  return state.sessions.filter((session) => {
    if (status === "favorite" && !session.favorite) return false;
    if (status === "archived" && !session.archived) return false;
    if (status === "active" && session.archived) return false;
    if (!$("#session-status-filter") && !showArchived && session.archived) return false;
    if (project && session.projectName !== project) return false;
    if (!query) return true;
    return [session.title, session.cwd, session.preview, session.path, session.projectName]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

async function refreshAll() {
  await Promise.allSettled([
    loadHealth(),
    loadConfig(),
    loadPreferences(),
    loadPaths(),
    loadRelease(),
    loadReleaseEnvironment(),
    loadReleaseDraft(),
    loadReleaseArtifacts(),
    loadAccounts(),
    loadSessions(),
    loadProviders(),
    loadBackups(),
    loadMcp(),
    loadSkills()
  ]);
  if (state.preferences?.startView && state.view === "dashboard" && state.preferences.startView !== "dashboard") {
    setView(state.preferences.startView);
  }
  startAutoRefresh();
  renderAll();
}

async function loadHealth() {
  state.health = await api("/api/health");
  $("#server-status").classList.add("ok");
  $("#server-status-text").textContent = "本地服务在线";
}

async function loadConfig() {
  state.config = await api("/api/config");
}

async function loadPreferences() {
  state.preferences = (await api("/api/preferences")).preferences;
}

async function loadPaths() {
  state.paths = (await api("/api/paths")).paths;
}

async function loadRelease() {
  state.release = await api("/api/release/check");
}

async function loadReleaseEnvironment() {
  state.releaseEnvironment = await api("/api/release/environment");
}

async function loadReleaseDraft() {
  state.releaseDraft = await api("/api/release/draft");
}

async function loadReleaseArtifacts() {
  state.releaseArtifacts = await api("/api/release/artifacts");
}

async function loadAccounts() {
  state.accounts = (await api("/api/accounts")).accounts;
  if (!state.selectedAccountId && state.accounts.length) {
    state.selectedAccountId = state.accounts[0].id;
  }
  if (state.selectedAccountId && !state.accounts.some((item) => item.id === state.selectedAccountId)) {
    state.selectedAccountId = state.accounts[0]?.id || null;
  }
}

async function loadSessions() {
  const payload = await api("/api/sessions");
  state.sessions = payload.sessions;
  state.sessionGroups = payload.grouped || [];
  if (!state.preferences && payload.preferences) state.preferences = payload.preferences;
}

async function loadProviders() {
  state.providers = (await api("/api/providers")).providers;
}

async function loadBackups() {
  state.backups = (await api("/api/backups")).backups;
}

async function loadMcp() {
  state.mcp = (await api("/api/mcp")).servers;
}

async function loadSkills() {
  const payload = await api("/api/skills");
  state.skills = payload.skills;
  state.skillBackups = payload.backups || [];
}

async function loadDiagnosis() {
  state.diagnosis = await api("/api/maintenance/diagnose");
}

async function loadPublishSafety() {
  state.publishSafety = await api("/api/maintenance/publish-safety");
}

async function loadCleanupTargets() {
  state.cleanupTargets = (await api("/api/maintenance/cleanup-targets")).targets;
}

function renderAll() {
  renderDashboard();
  renderAccounts();
  renderSessions();
  renderProviders();
  renderBackups();
  renderMcp();
  renderSkills();
  renderMaintenance();
  renderSettings();
}

function renderDashboard() {
  const config = state.config;
  $("#metric-config").textContent = config?.exists ? "已找到" : "未找到";
  $("#metric-config-path").textContent = config?.path || "";
  $("#metric-accounts").textContent = state.accounts.length;
  $("#metric-sessions").textContent = state.sessions.length;
  $("#metric-providers").textContent = state.providers.length;
  $("#config-raw").textContent = config?.masked || "未找到 Codex config.toml";

  const summary = config?.summary || {};
  $("#config-summary").innerHTML = dl({
    "当前模型": summary.model || "未设置",
    "模型来源": summary.modelProvider || "未设置",
    "推理强度": summary.reasoningEffort || "未设置",
    "审批策略": summary.approvalPolicy || "未设置",
    "可用 Provider 数量": summary.providers?.length ?? 0,
    "MCP 数量": summary.mcpServers?.length ?? 0,
    "项目数量": summary.projectsCount ?? 0
  });

  $("#hero-config-state").textContent = config?.exists ? "Codex 配置已识别" : "还没找到 Codex 配置";
  $("#hero-config-note").textContent = config?.exists
    ? `当前模型：${summary.model || "未设置"}，MCP：${summary.mcpServers?.length ?? 0} 个。`
    : "请先确认本机存在 .codex/config.toml，然后再刷新。";

  renderRecentSessions();
  renderRecentBackups();
}

function renderRecentSessions() {
  const root = $("#recent-sessions");
  const rows = state.sessions.filter((item) => !item.archived).slice(0, 4);
  if (!rows.length) {
    root.innerHTML = emptyInline("还没有扫描到线程。等你用 Codex 产生更多会话后，这里会自动出现。");
    return;
  }
  root.innerHTML = rows.map((session) => `
    <article class="stack-item">
      <strong>${escapeHtml(session.title || "未命名线程")}</strong>
      <p>${escapeHtml(session.cwd || "未知路径")}</p>
      <p>${relativeTime(session.updatedAt)} · ${bytes(session.size)}${session.favorite ? " · 已收藏" : ""}</p>
    </article>
  `).join("");
}

function renderRecentBackups() {
  const root = $("#recent-backups");
  const rows = state.backups.slice(0, 4);
  if (!rows.length) {
    root.innerHTML = emptyInline("还没有备份。右上角点一次“创建备份”，就能给自己留一条回头路。");
    return;
  }
  root.innerHTML = rows.map((backup) => `
    <article class="stack-item">
      <strong>${escapeHtml(backup.reason || "backup")}</strong>
      <p>${fmtDate(backup.createdAt)}</p>
      <p>${bytes(backup.size)} · ${escapeHtml(backup.path)}</p>
    </article>
  `).join("");
}

function dl(items) {
  return Object.entries(items)
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function renderAccounts() {
  const list = $("#accounts-list");
  const editor = $("#account-editor");
  if (!state.accounts.length) {
    list.innerHTML = emptyCard("还没有账号档案。建议先把当前 Codex 配置捕获下来，后面要切换就更安全。");
    editor.innerHTML = emptyCard("先捕获一个账号档案，右侧就会出现可编辑的本地状态信息。");
    return;
  }
  const selected = state.accounts.find((account) => account.id === state.selectedAccountId) || state.accounts[0];
  state.selectedAccountId = selected.id;
  list.innerHTML = state.accounts.map((account) => `
    <article class="item-card ${account.id === state.selectedAccountId ? "item-card-selected" : ""}">
      <h3>${escapeHtml(account.name)}</h3>
      <div class="item-meta">
        ${escapeHtml(account.note || "无备注")}<br />
        当前记录：模型 ${escapeHtml(account.summary?.model || "未设置")} · Provider ${escapeHtml(account.summary?.modelProvider || "未设置")}<br />
        状态：${escapeHtml(account.usage?.status || account.status || "unknown")} · ${escapeHtml(account.usage?.statusNote || "还没有检查状态")}<br />
        套餐：${escapeHtml(account.usage?.planName || "未填写")} · 生命周期 ${escapeHtml(account.usage?.lifecycle || "unknown")}<br />
        用量：${escapeHtml(String(account.usage?.quotaUsed || 0))} / ${escapeHtml(String(account.usage?.quotaLimit || 0))} ${escapeHtml(account.usage?.quotaUnit || "tokens")}<br />
        更新时间：${fmtDate(account.updatedAt)}
      </div>
      <div class="item-actions">
        <button class="ghost-button" data-account-select="${account.id}">查看详情</button>
        <button class="ghost-button" data-account-refresh="${account.id}">刷新状态</button>
        <button class="ghost-button" data-account-export="${account.id}">导出账号包</button>
        <button class="ghost-button" data-account-preview="${account.id}">预览切换</button>
        <button class="primary-button" data-account-apply="${account.id}">应用</button>
        <button class="danger-button" data-account-delete="${account.id}">删除档案</button>
      </div>
    </article>
  `).join("");
  editor.innerHTML = `
    <div class="surface-head">
      <div>
        <span class="eyebrow">本地状态档案</span>
        <h2>${escapeHtml(selected.name)}</h2>
      </div>
      <div class="item-actions compact">
        <span class="pill ${selected.usage?.status === "ready" ? "ok" : "warn"}">${escapeHtml(selected.usage?.status || "unknown")}</span>
      </div>
    </div>
    <form class="form" id="account-editor-form">
      <input type="hidden" id="account-editor-id" value="${escapeHtml(selected.id)}" />
      <label>账号名称<input id="account-editor-name" value="${escapeHtml(selected.name || "")}" required /></label>
      <label>公开备注<textarea id="account-editor-note" rows="2">${escapeHtml(selected.note || "")}</textarea></label>
      <label>归属备注<input id="account-editor-owner" value="${escapeHtml(selected.usage?.ownerLabel || "")}" placeholder="例如 主账号 / 测试账号" /></label>
      <label>套餐名称<input id="account-editor-plan" value="${escapeHtml(selected.usage?.planName || "")}" placeholder="例如 Pro / Pay-as-you-go" /></label>
      <label>生命周期
        <select id="account-editor-lifecycle">
          ${["active", "paused", "expired", "unknown"].map((value) => `
            <option value="${value}" ${selected.usage?.lifecycle === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      </label>
      <div class="form-grid form-grid-2">
        <label>续费日期<input id="account-editor-renewal" type="date" value="${escapeHtml(selected.usage?.renewalDate || "")}" /></label>
        <label>额度重置日<input id="account-editor-reset" type="date" value="${escapeHtml(selected.usage?.quotaResetDate || "")}" /></label>
      </div>
      <div class="form-grid form-grid-3">
        <label>已用额度<input id="account-editor-quota-used" type="number" min="0" step="1" value="${escapeHtml(String(selected.usage?.quotaUsed || 0))}" /></label>
        <label>额度上限<input id="account-editor-quota-limit" type="number" min="0" step="1" value="${escapeHtml(String(selected.usage?.quotaLimit || 0))}" /></label>
        <label>额度单位<input id="account-editor-quota-unit" value="${escapeHtml(selected.usage?.quotaUnit || "tokens")}" /></label>
      </div>
      <label>状态备注<textarea id="account-editor-status-note" rows="2">${escapeHtml(selected.usage?.statusNote || "")}</textarea></label>
      <label>私有笔记<textarea id="account-editor-private-note" rows="4">${escapeHtml(selected.usage?.privateNote || "")}</textarea></label>
      <div class="form-actions">
        <button type="submit" class="primary-button">保存本地状态</button>
        <button type="button" class="ghost-button" data-account-refresh="${selected.id}">重新检测</button>
      </div>
    </form>
    <div class="guide-list compact">
      <div class="guide-step">
        <strong>最后检查</strong>
        <p>${escapeHtml(selected.usage?.lastCheckedAt ? fmtDate(selected.usage.lastCheckedAt) : "还没有检测过状态")}</p>
      </div>
      <div class="guide-step">
        <strong>剩余额度</strong>
        <p>${selected.usage?.quotaRemaining == null ? "未填写上限，暂不计算剩余。" : `${selected.usage.quotaRemaining} ${selected.usage?.quotaUnit || "tokens"}`}</p>
      </div>
    </div>
  `;
}

function renderSessions() {
  const query = $("#session-search").value.trim().toLowerCase();
  const visible = filteredSessions();
  const projectSelect = $("#session-project-filter");
  if (projectSelect) {
    const current = projectSelect.value;
    const projects = [...new Set(state.sessions.map((item) => item.projectName || "未分类项目"))].sort((a, b) => a.localeCompare(b));
    projectSelect.innerHTML = `<option value="">全部项目</option>${projects.map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join("")}`;
    projectSelect.value = current && projects.includes(current) ? current : "";
  }

  const favoriteCount = state.sessions.filter((item) => item.favorite).length;
  const archivedCount = state.sessions.filter((item) => item.archived).length;
  const totalSize = state.sessions.reduce((sum, item) => sum + item.size, 0);
  const projectCount = new Set(state.sessions.map((item) => item.projectName || "未分类项目")).size;
  $("#session-summary").innerHTML = [
    stripCard("总线程数", state.sessions.length, "包括已归档线程"),
    stripCard("项目数", projectCount, "按 cwd 自动归类"),
    stripCard("已收藏", favoriteCount, "方便后续再找"),
    stripCard("已归档", archivedCount, "不会删除原始文件"),
    stripCard("总大小", bytes(totalSize), "基于扫描到的会话文件")
  ].join("");

  const groupsRoot = $("#session-groups");
  const groups = state.sessionGroups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => visible.some((item) => item.id === session.id))
    }))
    .filter((group) => group.sessions.length);
  groupsRoot.innerHTML = groups.length
    ? groups.map((group) => {
      const expanded = query || state.preferences?.groupSessionsByProject || state.expandedProjects.has(group.projectName);
      return `
        <article class="item-card">
          <div class="surface-head compact">
            <div>
              <h3>${escapeHtml(group.projectName)}</h3>
              <div class="item-meta">${escapeHtml(group.cwd || "未记录项目路径")}<br />${group.count} 个线程 · 最近更新 ${relativeTime(group.latestUpdatedAt)}</div>
            </div>
            <button class="ghost-button" data-project-toggle="${escapeHtml(group.projectName)}">${expanded ? "收起" : "展开"}</button>
          </div>
          ${expanded ? `
            <div class="grid-list compact">
              ${group.sessions.slice(0, 6).map((session) => `
                <article class="stack-item mini">
                  <strong>${escapeHtml(session.title || "未命名线程")}</strong>
                  <p>${fmtDateShort(session.updatedAt)} · ${session.favorite ? "已收藏" : "普通"}${session.archived ? " · 已归档" : ""}</p>
                </article>
              `).join("")}
            </div>
          ` : ""}
        </article>
      `;
    }).join("")
    : emptyCard(query ? "没有匹配的项目分组。" : "还没有可展示的项目分组。");

  $("#sessions-table").innerHTML = visible.map((session) => `
    <tr>
      <td class="row-title">
        <strong>${escapeHtml(session.title || "未命名线程")}</strong>
        <small>${escapeHtml(session.preview || session.path)}</small>
      </td>
      <td>${escapeHtml(session.cwd || "未知路径")}</td>
      <td>${fmtDateShort(session.updatedAt)}</td>
      <td>
        ${session.favorite ? '<span class="pill ok">收藏</span>' : '<span class="pill">普通</span>'}
        ${session.archived ? '<span class="pill warn">已归档</span>' : ''}
      </td>
      <td>
        <div class="item-actions">
          <button class="ghost-button" data-session-favorite="${session.id}">${session.favorite ? "取消收藏" : "收藏"}</button>
          <button class="ghost-button" data-session-archive="${session.id}">${session.archived ? "取消归档" : "归档"}</button>
          <button class="ghost-button" data-session-copy-path="${session.id}">复制路径</button>
          <button class="ghost-button" data-session-summary-export="${session.id}">导出摘要</button>
          <button class="ghost-button" data-session-export="${session.id}">导出</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">${query ? "没有匹配的线程。" : "还没有扫描到线程。"}</td></tr>`;
}

function renderProviders() {
  const list = $("#providers-list");
  $("#provider-banner").innerHTML = `
    <div>
      <strong>当前已保存 ${state.providers.length} 个 Provider</strong>
      <p>建议顺序：先新增 Provider，点“测试”，再点“预览路由”，最后才决定要不要“应用路由”。</p>
    </div>
  `;

  if (!state.providers.length) {
    list.innerHTML = emptyCard("还没有 Provider。你可以先加一个最常用的模型来源，把连通性测通。");
    return;
  }

  list.innerHTML = state.providers.map((provider) => `
    <article class="item-card">
      <h3>${escapeHtml(provider.name)} ${provider.enabled ? '<span class="pill ok">启用</span>' : '<span class="pill warn">停用</span>'}</h3>
      <div class="item-meta">
        ${escapeHtml(provider.baseUrl)}<br />
        默认模型：${escapeHtml(provider.defaultModel || "未设置")} · Key：${provider.hasApiKey ? escapeHtml(provider.apiKey) : "未填写"}<br />
        ${escapeHtml(provider.note || "没有备注")}
      </div>
      <div class="item-actions">
        <button class="ghost-button" data-provider-edit="${provider.id}">编辑</button>
        <button class="ghost-button" data-provider-test="${provider.id}">测试</button>
        <button class="ghost-button" data-provider-preview="${provider.id}">预览路由</button>
        <button class="primary-button" data-provider-apply="${provider.id}">应用路由</button>
        <button class="danger-button" data-provider-delete="${provider.id}">删除</button>
      </div>
    </article>
  `).join("");
}

function renderBackups() {
  $("#backups-table").innerHTML = state.backups.map((backup) => `
    <tr>
      <td>${fmtDate(backup.createdAt)}</td>
      <td>${escapeHtml(backup.reason || "backup")}</td>
      <td>${bytes(backup.size)}</td>
      <td>${escapeHtml(backup.path)}</td>
      <td><button class="danger-button" data-backup-restore="${backup.id}">恢复</button></td>
    </tr>
  `).join("") || `<tr><td colspan="5">还没有备份。</td></tr>`;
}

function renderMcp() {
  const enabledCount = state.mcp.filter((item) => item.enabled).length;
  $("#mcp-summary").innerHTML = [
    stripCard("服务数", state.mcp.length, "来自当前 Codex 配置"),
    stripCard("已启用", enabledCount, "enabled !== false"),
    stripCard("配置文件", state.config?.path || "未找到", "当前读取位置"),
    stripCard("修改方式", "预览后写入", "应用前会自动备份")
  ].join("");

  const list = $("#mcp-list");
  if (!state.mcp.length) {
    list.innerHTML = emptyCard("当前 Codex 配置里没有 MCP 服务。你可以从右侧表单新增一个。");
    return;
  }
  list.innerHTML = state.mcp.map((server) => `
    <article class="item-card">
      <h3>${escapeHtml(server.name)} ${server.enabled ? '<span class="pill ok">启用</span>' : '<span class="pill warn">停用</span>'}</h3>
      <div class="item-meta">
        command：${escapeHtml(server.command || "")}<br />
        cwd：${escapeHtml(server.cwd || "未设置")}<br />
        args：${escapeHtml((server.args || []).join(" ") || "无")}
      </div>
      <div class="item-actions">
        <button class="ghost-button" data-mcp-edit="${escapeHtml(server.name)}">编辑</button>
        <button class="ghost-button" data-mcp-test="${escapeHtml(server.name)}">测试</button>
        <button class="danger-button" data-mcp-delete="${escapeHtml(server.name)}">删除</button>
      </div>
      <pre class="code-box">${escapeHtml(JSON.stringify(server, null, 2))}</pre>
    </article>
  `).join("");
}

function renderSkills() {
  const localCount = state.skills.filter((skill) => skill.source === "local").length;
  const pluginCount = state.skills.filter((skill) => skill.source === "plugin-cache").length;
  $("#skills-summary").innerHTML = [
    stripCard("已扫描 Skill", state.skills.length, "来自本机 SKILL.md"),
    stripCard("本地 Skill", localCount, "可导入、备份、恢复、删除"),
    stripCard("插件缓存", pluginCount, "只读显示，不直接修改"),
    stripCard("Skill 备份", state.skillBackups.length, "恢复前会保留新的恢复点")
  ].join("");

  const list = $("#skills-list");
  if (!state.skills.length) {
    list.innerHTML = emptyCard("没有扫描到本机 Skill 文件。");
    return;
  }
  list.innerHTML = state.skills.map((skill) => `
    <article class="item-card">
      <h3>${escapeHtml(skill.name)} ${skill.source === "local" ? '<span class="pill ok">本地</span>' : '<span class="pill warn">插件缓存</span>'}</h3>
      <div class="item-meta">${escapeHtml(skill.description || "")}<br />${escapeHtml(skill.path)}</div>
      <div class="item-actions">
        <button class="ghost-button" data-skill-copy="${skill.id}">复制路径</button>
        ${skill.source === "local" ? `<button class="danger-button" data-skill-delete="${skill.id}">删除</button>` : ""}
      </div>
    </article>
  `).join("");

  const backupsRoot = $("#skill-backups-list");
  backupsRoot.innerHTML = state.skillBackups.length
    ? state.skillBackups.map((backup) => `
      <article class="item-card">
        <h3>${escapeHtml(backup.reason || "skill-backup")}</h3>
        <div class="item-meta">${fmtDate(backup.createdAt)}<br />${escapeHtml((backup.entries || []).join(", ") || "无条目记录")}</div>
        <div class="item-actions">
          <button class="ghost-button" data-skill-backup-copy="${backup.id}">复制路径</button>
          <button class="primary-button" data-skill-backup-restore="${backup.id}">恢复</button>
        </div>
      </article>
    `).join("")
    : emptyCard("还没有 Skill 备份。建议先点一次“备份 Skills”。");
}

function renderMaintenance() {
  const diagnosis = state.diagnosis;
  const safety = state.publishSafety;
  if (!diagnosis) {
    $("#diagnose-summary").innerHTML = [
      stripCard("诊断状态", "未运行", "点击右上角运行诊断"),
      stripCard("清理范围", "导出文件", "不会清理原始会话"),
      stripCard("路由处理", "可预览", "只移除 CodexMaMi 路由块"),
      stripCard("安全策略", "确认后执行", "危险动作不直接运行")
    ].join("");
    $("#diagnose-list").innerHTML = emptyCard("还没有诊断结果。");
    $("#publish-safety-list").innerHTML = safety ? renderPublishSafetyList(safety) : emptyCard("还没有公开前安全扫描结果。");
    $("#codex-process-list").innerHTML = emptyCard("运行诊断后会显示 Codex 相关进程。");
    return;
  }

  $("#diagnose-summary").innerHTML = [
    stripCard("配置状态", diagnosis.ok ? "正常" : "需检查", diagnosis.paths.configPath),
    stripCard("线程数", diagnosis.counts.sessions, "扫描到的本机会话"),
    stripCard("备份数", diagnosis.counts.backups, "可恢复配置快照"),
    stripCard("路由块", diagnosis.managedRouteEnabled ? "已启用" : "未启用", "CodexMaMi 管理")
  ].join("");

  $("#diagnose-list").innerHTML = diagnosis.checks.map((check) => `
    <article class="item-card">
      <h3>${escapeHtml(check.name)} ${check.ok ? '<span class="pill ok">正常</span>' : '<span class="pill warn">需检查</span>'}</h3>
      <div class="item-meta">${escapeHtml(check.detail)}</div>
    </article>
  `).join("");

  $("#codex-process-list").innerHTML = diagnosis.codexProcesses.length
    ? diagnosis.codexProcesses.map((process) => `
      <article class="item-card">
        <h3>${escapeHtml(process.image || "Codex process")}</h3>
        <div class="item-meta">PID：${escapeHtml(process.pid || "未知")} · 内存：${escapeHtml(process.memory || "未知")}</div>
      </article>
    `).join("")
    : emptyCard("没有检测到 Codex 相关进程，或当前系统不支持进程扫描。");
  $("#publish-safety-list").innerHTML = safety ? renderPublishSafetyList(safety) : emptyCard("还没有公开前安全扫描结果。");
}

function renderPublishSafetyList(safety) {
  const checkCards = safety.checks.map((check) => `
    <article class="item-card">
      <h3>${escapeHtml(check.name)} ${check.ok ? '<span class="pill ok">通过</span>' : '<span class="pill warn">需处理</span>'}</h3>
      <div class="item-meta">${escapeHtml(check.detail || "")}</div>
    </article>
  `).join("");
  const findingCards = safety.findings.length
    ? safety.findings.map((finding) => `
      <article class="item-card">
        <h3>${escapeHtml(finding.kind)} <span class="pill ${finding.severity === "high" ? "warn" : ""}">${escapeHtml(finding.severity)}</span></h3>
        <div class="item-meta">${escapeHtml(finding.message)}<br />${escapeHtml(finding.path)}</div>
      </article>
    `).join("")
    : emptyCard("没有发现明显的本地数据或密钥风险。");
  return `
    <div class="metric-strip">
      ${stripCard("扫描状态", safety.ok ? "可公开" : "需检查", safety.root)}
      ${stripCard("风险项", safety.findings.length, "高风险项公开前必须处理")}
      ${stripCard("检查项", safety.checks.length, "包含 .gitignore 与密钥模式")}
      ${stripCard("扫描时间", fmtDateShort(safety.generatedAt), "本地源代码目录")}
    </div>
    <div class="grid-list compact">${checkCards}${findingCards}</div>
  `;
}

function renderSettings() {
  const preferences = state.preferences || {};
  const release = state.release || {};
  const environment = state.releaseEnvironment || {};
  const draft = state.releaseDraft || {};
  const artifacts = state.releaseArtifacts || environment.artifacts || {};
  $("#path-summary").innerHTML = dl({
    "Codex Home": state.paths?.codexHome || state.config?.codexHome || "",
    "Codex 配置": state.paths?.configPath || state.config?.path || "",
    "CodexMaMi 数据": state.paths?.appHome || state.config?.appHome || "",
    "Skills 目录": state.paths?.skillsDir || "",
    "Skill 备份": state.paths?.skillBackupsDir || "",
    "安装产物目录": state.paths?.releaseArtifactsDir || "",
    "本地服务地址": window.location.origin
  });
  $("#path-actions").innerHTML = [
    actionTile("复制 Codex Home", "把路径复制到剪贴板，再去资源管理器打开。", "path-codex-home"),
    actionTile("复制配置路径", "适合排查 config.toml 或自己手动备份。", "path-config"),
    actionTile("复制数据目录", "备份 CodexMaMi 自己的数据和导出。", "path-app-home"),
    actionTile("复制 Skills 目录", "导入本地 Skill 时会用到这个位置。", "path-skills"),
    actionTile("复制安装产物目录", "打包后可直接检查 .msi / .exe 是否生成。", "path-release-artifacts")
  ].join("");

  $("#pref-start-view").value = preferences.startView || "dashboard";
  $("#pref-auto-refresh").value = preferences.autoRefreshSec ?? 0;
  $("#pref-group-sessions").checked = preferences.groupSessionsByProject !== false;
  $("#pref-show-archived").checked = preferences.showArchivedSessions === true;
  $("#pref-release-version").value = preferences.releaseLatestVersion || "";
  $("#pref-release-repo").value = preferences.releaseGithubRepo || "";
  $("#pref-release-api-base").value = preferences.releaseApiBaseUrl || "";
  $("#pref-release-notes").value = preferences.releaseLatestNotes || "";
  $("#release-status").innerHTML = [
    actionStatusCard("当前版本", release.currentVersion || "0.1.0", release.source === "github" ? `来自 GitHub 仓库 ${release.repo}` : "当前应用版本号"),
    actionStatusCard("最新公开版本", release.latestVersion || "未设置", release.hasUpdate ? "有新版本待发布或待安装" : "当前没有检测到更高版本"),
    actionStatusCard("更新状态", release.hasUpdate ? "可更新" : "已最新", release.latestNotes || "你可以在上方填入版本说明，给自己和协作者看"),
    actionStatusCard("发布链接", release.url || "未连接", release.url ? "已连接 GitHub latest release" : "当前使用本地版本跟踪")
  ].join("");
  $("#release-environment").innerHTML = environment.checks?.length
    ? environment.checks.map((check) => actionStatusCard(check.name, check.ok ? "正常" : "缺失/异常", check.detail || "")).join("")
    : emptyCard("还没有安装环境检查结果。");
  $("#release-artifacts").innerHTML = artifacts.artifacts?.length
    ? artifacts.artifacts.map((item) => actionStatusCard(item.name, `${bytes(item.size)} · ${item.type.toUpperCase()}`, `${fmtDate(item.updatedAt)} · ${item.path}`)).join("")
    : emptyCard("还没有检测到 Windows 安装产物。");
  $("#release-draft-title").textContent = draft.title || "CodexMaMi v0.1.0";
  $("#release-draft-body").textContent = draft.body || "保存发布说明后，这里会生成一份可复制的 GitHub Release 草稿。";
}

function stripCard(label, value, note) {
  return `
    <article class="strip-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function actionTile(title, note, copyKey) {
  return `
    <article class="item-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="item-meta">${escapeHtml(note)}</div>
      <div class="item-actions">
        <button class="ghost-button" data-copy-path="${copyKey}">复制路径</button>
      </div>
    </article>
  `;
}

function actionStatusCard(title, value, note) {
  return `
    <article class="item-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="item-meta"><strong>${escapeHtml(value)}</strong><br />${escapeHtml(note)}</div>
    </article>
  `;
}

function emptyCard(message) {
  return `<article class="item-card"><div class="item-meta">${escapeHtml(message)}</div></article>`;
}

function emptyInline(message) {
  return `<article class="stack-item"><p>${escapeHtml(message)}</p></article>`;
}

async function confirmModal(title, body, dangerLabel = "确认") {
  const modal = $("#modal");
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-confirm").textContent = dangerLabel;
  modal.showModal();
  return new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue === "confirm"), { once: true });
  });
}

function renderDiff(diff) {
  return `<pre class="diff">${escapeHtml(diff)
    .replace(/^(\+ .*)$/gm, '<span class="add">$1</span>')
    .replace(/^(- .*)$/gm, '<span class="remove">$1</span>')}</pre>`;
}

async function captureAccount() {
  const name = prompt("账号档案名称", `Codex profile ${new Date().toLocaleString()}`);
  if (!name) return;
  const note = prompt("备注，可留空", "") || "";
  await api("/api/accounts/capture", { method: "POST", body: { name, note } });
  toast("已捕获当前 Codex 配置");
  await loadAccounts();
  renderAccounts();
  renderDashboard();
}

async function createBackup() {
  await api("/api/backups", { method: "POST", body: { reason: "manual-ui" } });
  toast("已创建备份");
  await loadBackups();
  renderBackups();
  renderDashboard();
}

async function previewAccount(id) {
  const result = await api(`/api/accounts/${encodeURIComponent(id)}/preview`, { method: "POST" });
  await confirmModal(`预览切换：${result.account.name}`, renderDiff(result.diff), "关闭");
}

async function applyAccount(id) {
  const result = await api(`/api/accounts/${encodeURIComponent(id)}/preview`, { method: "POST" });
  const ok = await confirmModal(
    `应用账号：${result.account.name}`,
    `<p class="muted">将先创建备份，再用此账号档案覆盖 Codex config.toml。</p>${renderDiff(result.diff)}`,
    "确认应用"
  );
  if (!ok) return;
  await api(`/api/accounts/${encodeURIComponent(id)}/apply`, { method: "POST", body: { confirm: true } });
  toast("账号配置已应用，建议重启 Codex");
  await refreshAll();
}

async function deleteAccount(id) {
  const ok = await confirmModal("删除账号档案", "<p>这只会删除 CodexMaMi 的本地档案，不会删除 Codex 配置。</p>", "删除");
  if (!ok) return;
  await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  toast("账号档案已删除");
  await loadAccounts();
  renderAccounts();
  renderDashboard();
}

async function exportAccountBundle(id) {
  const result = await api(`/api/accounts/${encodeURIComponent(id)}/export`);
  await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  toast("账号包 JSON 已复制到剪贴板");
}

async function refreshAccountStatus(id) {
  await api(`/api/accounts/${encodeURIComponent(id)}/status-refresh`, { method: "POST" });
  toast("账号状态已刷新");
  await loadAccounts();
  renderAccounts();
}

async function saveAccountMetadata(event) {
  event.preventDefault();
  const id = $("#account-editor-id").value;
  await api(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: {
      name: $("#account-editor-name").value,
      note: $("#account-editor-note").value,
      ownerLabel: $("#account-editor-owner").value,
      planName: $("#account-editor-plan").value,
      lifecycle: $("#account-editor-lifecycle").value,
      renewalDate: $("#account-editor-renewal").value,
      quotaResetDate: $("#account-editor-reset").value,
      quotaUsed: Number($("#account-editor-quota-used").value || 0),
      quotaLimit: Number($("#account-editor-quota-limit").value || 0),
      quotaUnit: $("#account-editor-quota-unit").value,
      statusNote: $("#account-editor-status-note").value,
      privateNote: $("#account-editor-private-note").value
    }
  });
  toast("账号本地状态已保存");
  await loadAccounts();
  renderAccounts();
}

async function importAccountBundleFromForm(event) {
  event.preventDefault();
  const raw = $("#account-import-json").value.trim();
  if (!raw) return;
  await api("/api/accounts/import", { method: "POST", body: JSON.parse(raw) });
  toast("账号包已导入");
  $("#account-import-json").value = "";
  await loadAccounts();
  renderAccounts();
  renderDashboard();
}

function fillProviderForm(provider = {}) {
  state.selectedProvider = provider.id || null;
  $("#provider-id").value = provider.id || "";
  $("#provider-name").value = provider.name || "";
  $("#provider-base-url").value = provider.baseUrl || "";
  $("#provider-api-key").value = provider.hasApiKey ? "" : provider.apiKey || "";
  $("#provider-models").value = (provider.models || []).join("\n");
  $("#provider-default-model").value = provider.defaultModel || "";
  $("#provider-note").value = provider.note || "";
  $("#provider-enabled").checked = provider.enabled !== false;
}

function fillMcpForm(server = {}) {
  $("#mcp-name").value = server.name || "";
  $("#mcp-command").value = server.command || "";
  $("#mcp-cwd").value = server.cwd || "";
  $("#mcp-args").value = Array.isArray(server.args) ? server.args.join("\n") : "";
  $("#mcp-env").value = server.env ? Object.entries(server.env).map(([key, value]) => `${key}=${value}`).join("\n") : "";
  $("#mcp-enabled").checked = server.enabled !== false;
}

function readMcpForm() {
  return {
    name: $("#mcp-name").value,
    command: $("#mcp-command").value,
    cwd: $("#mcp-cwd").value,
    args: $("#mcp-args").value,
    env: $("#mcp-env").value,
    enabled: $("#mcp-enabled").checked
  };
}

async function saveProvider(event) {
  event.preventDefault();
  const id = $("#provider-id").value;
  const body = {
    name: $("#provider-name").value,
    baseUrl: $("#provider-base-url").value,
    apiKey: $("#provider-api-key").value,
    models: $("#provider-models").value,
    defaultModel: $("#provider-default-model").value,
    note: $("#provider-note").value,
    enabled: $("#provider-enabled").checked
  };
  if (!body.apiKey && id) delete body.apiKey;
  if (id) {
    await api(`/api/providers/${encodeURIComponent(id)}`, { method: "PUT", body });
  } else {
    await api("/api/providers", { method: "POST", body });
  }
  toast("Provider 已保存");
  fillProviderForm();
  await loadProviders();
  renderProviders();
  renderDashboard();
}

async function saveMcp(event) {
  event.preventDefault();
  const body = readMcpForm();
  const preview = await api("/api/mcp/preview", { method: "POST", body });
  const ok = await confirmModal(
    `保存 MCP：${body.name}`,
    `<p class="muted">将先备份当前 config.toml，再写入下面的 MCP 配置变化。</p>${renderDiff(preview.diff)}`,
    "确认保存"
  );
  if (!ok) return;
  await api("/api/mcp/apply", { method: "POST", body: { ...body, confirm: true } });
  toast("MCP 已保存，建议重启 Codex");
  fillMcpForm();
  await refreshAll();
}

async function testProvider(id) {
  try {
    const result = await api(`/api/providers/${encodeURIComponent(id)}/test`, { method: "POST" });
    toast(`连接成功：${result.models?.slice(0, 3).join(", ") || result.status}`);
  } catch (error) {
    toast(error.message);
  }
}

async function previewRoute(id) {
  const result = await api(`/api/providers/${encodeURIComponent(id)}/route-preview`, { method: "POST" });
  await confirmModal(`预览路由：${result.provider.name}`, renderDiff(result.diff), "关闭");
}

async function applyRoute(id) {
  const result = await api(`/api/providers/${encodeURIComponent(id)}/route-preview`, { method: "POST" });
  const ok = await confirmModal(
    `应用路由：${result.provider.name}`,
    `<p class="muted">将先备份 config.toml，再写入 CodexMaMi 管理的路由块。</p>${renderDiff(result.diff)}`,
    "确认应用"
  );
  if (!ok) return;
  await api(`/api/providers/${encodeURIComponent(id)}/apply-route`, { method: "POST", body: { confirm: true } });
  toast("路由已应用，建议重启 Codex");
  await refreshAll();
}

async function deleteProvider(id) {
  const ok = await confirmModal("删除 Provider", "<p>这会删除 CodexMaMi 保存的 Provider，本地 Codex 配置不会自动修改。</p>", "删除");
  if (!ok) return;
  await api(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  toast("Provider 已删除");
  await loadProviders();
  renderProviders();
  renderDashboard();
}

async function deleteMcp(name) {
  const preview = await api(`/api/mcp/${encodeURIComponent(name)}/delete-preview`, { method: "POST" });
  const ok = await confirmModal(
    `删除 MCP：${name}`,
    `<p class="muted">这会从 Codex config.toml 移除此 MCP 服务，应用前会自动备份。</p>${renderDiff(preview.diff)}`,
    "确认删除"
  );
  if (!ok) return;
  await api(`/api/mcp/${encodeURIComponent(name)}/delete`, { method: "POST", body: { confirm: true } });
  toast("MCP 已删除，建议重启 Codex");
  await refreshAll();
}

async function testMcp(name) {
  const result = await api(`/api/mcp/${encodeURIComponent(name)}/test`, { method: "POST" });
  await confirmModal(
    `MCP 测试：${name}`,
    `<p class="muted">${escapeHtml(result.detail || "")}</p>
      ${result.stdout ? `<pre class="code-box">${escapeHtml(result.stdout)}</pre>` : ""}
      ${result.stderr ? `<pre class="code-box">${escapeHtml(result.stderr)}</pre>` : ""}`,
    "关闭"
  );
}

async function updateSession(id, key, value) {
  await api(`/api/sessions/${encodeURIComponent(id)}/state`, { method: "POST", body: { [key]: value } });
  await loadSessions();
  renderSessions();
  renderDashboard();
}

async function exportSession(id) {
  const result = await api(`/api/sessions/${encodeURIComponent(id)}/export`, { method: "POST" });
  toast(`已导出：${result.path}`);
}

async function exportSessionSummary(id) {
  const result = await api(`/api/sessions/${encodeURIComponent(id)}/summary-export`, { method: "POST" });
  toast(`摘要已导出：${result.path}`);
}

async function copySessionPath(id) {
  const session = state.sessions.find((item) => item.id === id) || (await api(`/api/sessions/${encodeURIComponent(id)}`)).session;
  await navigator.clipboard.writeText(session.path || "");
  toast("线程路径已复制");
}

async function restoreBackup(id) {
  const ok = await confirmModal("恢复备份", "<p>恢复前会再次备份当前 config.toml，然后用所选备份覆盖当前配置。</p>", "确认恢复");
  if (!ok) return;
  await api("/api/backups/restore", { method: "POST", body: { id, confirm: true } });
  toast("备份已恢复，建议重启 Codex");
  await refreshAll();
}

async function runDiagnosis() {
  await loadDiagnosis();
  renderMaintenance();
  toast("诊断完成");
}

async function runPublishSafety() {
  await loadPublishSafety();
  renderMaintenance();
  toast("公开前安全扫描完成");
}

async function disableManagedRoute() {
  const ok = await confirmModal(
    "禁用 CodexMaMi 路由块",
    "<p class=\"muted\">这会先备份当前 config.toml，然后移除 BEGIN/END CODEXMAMI ROUTING 之间的内容。</p>",
    "确认禁用"
  );
  if (!ok) return;
  await api("/api/routing/disable", { method: "POST", body: { confirm: true } });
  toast("已禁用 CodexMaMi 路由块，建议重启 Codex");
  await refreshAll();
}

async function cleanupExports() {
  await loadCleanupTargets();
  const totalSize = state.cleanupTargets.reduce((sum, item) => sum + item.size, 0);
  const body = state.cleanupTargets.length
    ? `<p class="muted">将清理 ${state.cleanupTargets.length} 个导出文件，共 ${bytes(totalSize)}。不会删除 Codex 原始会话。</p>`
    : "<p class=\"muted\">当前没有可清理的导出文件。</p>";
  const ok = await confirmModal("清理 CodexMaMi 导出文件", body, state.cleanupTargets.length ? "确认清理" : "关闭");
  if (!ok || !state.cleanupTargets.length) return;
  await api("/api/maintenance/cleanup", { method: "POST", body: { confirm: true } });
  toast("导出文件已清理");
  await loadCleanupTargets();
  await runDiagnosis();
}

function fillSkillForm(skill = {}) {
  $("#skill-name").value = skill.name || "";
  $("#skill-content").value = skill.content || "";
}

async function saveSkill(event) {
  event.preventDefault();
  await api("/api/skills/import", {
    method: "POST",
    body: {
      name: $("#skill-name").value,
      content: $("#skill-content").value
    }
  });
  toast("Skill 已导入到本机目录");
  fillSkillForm();
  await loadSkills();
  renderSkills();
}

async function createSkillBackup() {
  await api("/api/skills/backups", { method: "POST", body: { reason: "manual-ui" } });
  toast("Skills 备份已创建");
  await loadSkills();
  renderSkills();
}

async function deleteSkill(id) {
  const skill = state.skills.find((item) => item.id === id);
  const ok = await confirmModal(
    `删除 Skill：${skill?.name || ""}`,
    "<p class=\"muted\">只会删除本地 skills 目录里的这个 Skill，并且会先自动创建一份 Skills 备份。</p>",
    "确认删除"
  );
  if (!ok) return;
  await api(`/api/skills/${encodeURIComponent(id)}/delete`, { method: "POST", body: { confirm: true } });
  toast("本地 Skill 已删除");
  await loadSkills();
  renderSkills();
}

async function restoreSkillBackup(id) {
  const ok = await confirmModal(
    "恢复 Skill 备份",
    "<p class=\"muted\">恢复前会再备份一次当前本地 Skills。恢复只影响本地 skills 目录，不动插件缓存。</p>",
    "确认恢复"
  );
  if (!ok) return;
  await api(`/api/skills/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: { confirm: true } });
  toast("Skill 备份已恢复");
  await loadSkills();
  renderSkills();
}

async function savePreferences(event) {
  event.preventDefault();
  const preferences = (await api("/api/preferences", {
    method: "POST",
    body: {
      startView: $("#pref-start-view").value,
      autoRefreshSec: Number($("#pref-auto-refresh").value || 0),
      groupSessionsByProject: $("#pref-group-sessions").checked,
      showArchivedSessions: $("#pref-show-archived").checked,
      releaseLatestVersion: $("#pref-release-version").value,
      releaseGithubRepo: $("#pref-release-repo").value,
      releaseApiBaseUrl: $("#pref-release-api-base").value,
      releaseLatestNotes: $("#pref-release-notes").value,
      activeView: state.view
    }
  })).preferences;
  state.preferences = preferences;
  await loadRelease();
  toast("偏好已保存");
  renderSessions();
  renderSettings();
  startAutoRefresh();
}

async function refreshReleaseStatus() {
  await loadRelease();
  await loadReleaseEnvironment();
  await loadReleaseDraft();
  await loadReleaseArtifacts();
  renderSettings();
  toast("发布状态已刷新");
}

async function copyReleaseDraft() {
  await navigator.clipboard.writeText(state.releaseDraft?.body || "");
  toast("Release 草稿已复制到剪贴板");
}

function toggleProject(projectName) {
  if (state.expandedProjects.has(projectName)) {
    state.expandedProjects.delete(projectName);
  } else {
    state.expandedProjects.add(projectName);
  }
  renderSessions();
}

function pathValueFromKey(key) {
  const paths = state.paths || {};
  return {
    "path-codex-home": paths.codexHome,
    "path-config": paths.configPath,
    "path-app-home": paths.appHome,
    "path-skills": paths.skillsDir,
    "path-release-artifacts": paths.releaseArtifactsDir
  }[key] || "";
}

function startAutoRefresh() {
  clearInterval(startAutoRefresh.timer);
  const seconds = Number(state.preferences?.autoRefreshSec || 0);
  if (!seconds) return;
  startAutoRefresh.timer = setInterval(() => {
    refreshAll().catch(() => {});
  }, seconds * 1000);
}

function bindEvents() {
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
  $("#refresh-btn").addEventListener("click", () => refreshAll().then(() => toast("已刷新")));
  $("#backup-now-btn").addEventListener("click", createBackup);
  $("#import-account-btn").addEventListener("click", () => $("#account-import-json").focus());
  $("#capture-account-btn").addEventListener("click", captureAccount);
  $("#account-import-form").addEventListener("submit", importAccountBundleFromForm);
  $("#account-import-clear-btn").addEventListener("click", () => { $("#account-import-json").value = ""; });
  $("#capture-account-inline-btn").addEventListener("click", captureAccount);
  $("#new-provider-btn").addEventListener("click", () => fillProviderForm());
  $("#provider-clear-btn").addEventListener("click", () => fillProviderForm());
  $("#provider-form").addEventListener("submit", saveProvider);
  $("#new-mcp-btn").addEventListener("click", () => fillMcpForm());
  $("#mcp-clear-btn").addEventListener("click", () => fillMcpForm());
  $("#mcp-form").addEventListener("submit", saveMcp);
  $("#new-skill-btn").addEventListener("click", () => fillSkillForm());
  $("#backup-skills-btn").addEventListener("click", createSkillBackup);
  $("#skill-clear-btn").addEventListener("click", () => fillSkillForm());
  $("#skill-form").addEventListener("submit", saveSkill);
  $("#run-diagnose-btn").addEventListener("click", runDiagnosis);
  $("#run-publish-safety-btn").addEventListener("click", runPublishSafety);
  $("#maintenance-backup-btn").addEventListener("click", createBackup);
  $("#disable-route-btn").addEventListener("click", disableManagedRoute);
  $("#cleanup-exports-btn").addEventListener("click", cleanupExports);
  $("#preferences-form").addEventListener("submit", savePreferences);
  $("#refresh-release-btn").addEventListener("click", refreshReleaseStatus);
  $("#copy-release-draft-btn").addEventListener("click", copyReleaseDraft);
  $("#session-search").addEventListener("input", renderSessions);
  $("#session-status-filter").addEventListener("change", renderSessions);
  $("#session-project-filter").addEventListener("change", renderSessions);
  document.addEventListener("submit", async (event) => {
    if (event.target.id === "account-editor-form") {
      await saveAccountMetadata(event);
    }
  });

  document.body.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.dataset.goto) {
      setView(target.dataset.goto);
      return;
    }

    if (target.dataset.accountPreview) await previewAccount(target.dataset.accountPreview);
    if (target.dataset.accountSelect) {
      state.selectedAccountId = target.dataset.accountSelect;
      renderAccounts();
    }
    if (target.dataset.accountApply) await applyAccount(target.dataset.accountApply);
    if (target.dataset.accountDelete) await deleteAccount(target.dataset.accountDelete);
    if (target.dataset.accountRefresh) await refreshAccountStatus(target.dataset.accountRefresh);
    if (target.dataset.accountExport) await exportAccountBundle(target.dataset.accountExport);
    if (target.dataset.providerEdit) fillProviderForm(state.providers.find((item) => item.id === target.dataset.providerEdit));
    if (target.dataset.providerTest) await testProvider(target.dataset.providerTest);
    if (target.dataset.providerPreview) await previewRoute(target.dataset.providerPreview);
    if (target.dataset.providerApply) await applyRoute(target.dataset.providerApply);
    if (target.dataset.providerDelete) await deleteProvider(target.dataset.providerDelete);
    if (target.dataset.mcpEdit) fillMcpForm(state.mcp.find((item) => item.name === target.dataset.mcpEdit));
    if (target.dataset.mcpTest) await testMcp(target.dataset.mcpTest);
    if (target.dataset.mcpDelete) await deleteMcp(target.dataset.mcpDelete);
    if (target.dataset.skillDelete) await deleteSkill(target.dataset.skillDelete);
    if (target.dataset.skillBackupRestore) await restoreSkillBackup(target.dataset.skillBackupRestore);
    if (target.dataset.projectToggle) toggleProject(target.dataset.projectToggle);
    if (target.dataset.sessionFavorite) {
      const session = state.sessions.find((item) => item.id === target.dataset.sessionFavorite);
      await updateSession(session.id, "favorite", !session.favorite);
    }
    if (target.dataset.sessionArchive) {
      const session = state.sessions.find((item) => item.id === target.dataset.sessionArchive);
      await updateSession(session.id, "archive", !session.archived);
    }
    if (target.dataset.sessionExport) await exportSession(target.dataset.sessionExport);
    if (target.dataset.sessionSummaryExport) await exportSessionSummary(target.dataset.sessionSummaryExport);
    if (target.dataset.sessionCopyPath) await copySessionPath(target.dataset.sessionCopyPath);
    if (target.dataset.backupRestore) await restoreBackup(target.dataset.backupRestore);
    if (target.dataset.copy === "config") {
      await navigator.clipboard.writeText(JSON.stringify(state.config?.summary || {}, null, 2));
      toast("已复制摘要");
    }
    if (target.dataset.copy === "config-raw") {
      await navigator.clipboard.writeText(state.config?.masked || "");
      toast("已复制配置");
    }
    if (target.dataset.skillCopy) {
      const skill = state.skills.find((item) => item.id === target.dataset.skillCopy);
      await navigator.clipboard.writeText(skill?.path || "");
      toast("已复制 Skill 路径");
    }
    if (target.dataset.skillBackupCopy) {
      const backup = state.skillBackups.find((item) => item.id === target.dataset.skillBackupCopy);
      await navigator.clipboard.writeText(backup?.path || "");
      toast("已复制备份路径");
    }
    if (target.dataset.copyPath) {
      await navigator.clipboard.writeText(pathValueFromKey(target.dataset.copyPath));
      toast("已复制路径");
    }
  });
}

bindEvents();
setView("dashboard");
refreshAll().catch((error) => {
  $("#server-status-text").textContent = "连接失败";
  toast(error.message);
});
