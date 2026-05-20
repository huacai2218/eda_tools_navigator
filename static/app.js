const $ = (selector) => document.querySelector(selector);

const loginView = $("#loginView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const loginStatus = $("#loginStatus");
const sessionMeta = $("#sessionMeta");
const logoutBtn = $("#logoutBtn");
const titleMeta = $("#titleMeta");
const materialsList = $("#materialsList");
const quickManuals = $("#quickManuals");
const manualSearchForm = $("#manualSearchForm");
const manualSearch = $("#manualSearch");
const manualOptions = $("#manualOptions");
const readerSearchForm = $("#readerSearchForm");
const readerSearch = $("#readerSearch");
const readerSearchStatus = $("#readerSearchStatus");
const materialFrame = $("#materialFrame");
const workPanel = $("#workPanel");
const splitter = $("#splitter");
const togglePanelBtn = $("#togglePanelBtn");
const messages = $("#messages");
const chatForm = $("#chatForm");
const questionInput = $("#question");
const scriptFile = $("#scriptFile");
const scriptText = $("#scriptText");
const annotateBtn = $("#annotateBtn");
const annotationResult = $("#annotationResult");
const chooseWorkspaceBtn = $("#chooseWorkspaceBtn");
const saveScriptBtn = $("#saveScriptBtn");
const downloadAnnotationBtn = $("#downloadAnnotationBtn");
const settingsForm = $("#settingsForm");
const clearSettingsBtn = $("#clearSettingsBtn");
const settingsStatus = $("#settingsStatus");
const llmBaseUrlInput = $("#llmBaseUrl");
const llmModelInput = $("#llmModel");
const llmApiKeyInput = $("#llmApiKey");
const llmTimeoutInput = $("#llmTimeout");

const SETTINGS_KEY = "edaToolsNavigator.llmSettings";
const SCRIPT_STORE_KEY = "edaToolsNavigator.lastScript";
let currentUser = null;
let activeSourcePath = "";
let activeMaterialKind = "";
let latestAnnotationMarkdown = "";
let directoryHandle = null;
let manualCandidates = [];

async function readJsonResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = { error: `响应不是有效 JSON：${error.message}` };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} ${res.statusText}`);
  return data;
}

function networkErrorMessage(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "无法连接后端服务。请确认 server.py 正在运行。";
  }
  return error.message;
}

function defaultLlmSettings() {
  return { llm_base_url: "", llm_model: "internal-llm", llm_api_key: "", llm_timeout: 120 };
}

function getLlmSettings() {
  try {
    return { ...defaultLlmSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaultLlmSettings();
  }
}

function saveLlmSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function personalLlmEnabled() {
  const settings = getLlmSettings();
  return Boolean(settings.llm_base_url && settings.llm_model && settings.llm_api_key);
}

function applySettings(data = getLlmSettings()) {
  llmBaseUrlInput.value = data.llm_base_url || "";
  llmModelInput.value = data.llm_model || "internal-llm";
  llmApiKeyInput.value = data.llm_api_key || "";
  llmTimeoutInput.value = data.llm_timeout || 120;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceLabel(source, index) {
  const page = source.page ? `, p.${source.page}` : "";
  const type = source.material_type ? `${source.material_type} / ` : "";
  return `[${index}] ${type}${source.tool} / ${source.title}${page}`;
}

function openMaterial(url, sourcePath = "") {
  if (!url) return;
  activeSourcePath = sourcePath || activeSourcePath;
  const path = sourcePath || "";
  activeMaterialKind = path.toLowerCase().endsWith(".pdf") ? "pdf" : "";
  if (readerSearchStatus) {
    readerSearchStatus.textContent = activeMaterialKind === "pdf"
      ? "也可使用浏览器 PDF 工具栏内置查找做页内精确定位。"
      : "当前不是 PDF，查找会基于已索引文本跳转到相关位置。";
  }
  materialFrame.src = url;
}

function renderTextWithCitations(container, text, sources) {
  const pattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const index = Number(match[1]);
    const source = sources[index - 1];
    if (!source) {
      container.appendChild(document.createTextNode(match[0]));
      lastIndex = pattern.lastIndex;
      continue;
    }
    const link = document.createElement("a");
    link.className = "citation";
    link.href = source.source_url || `/source?chunk_id=${source.chunk_id}`;
    link.textContent = `[${index}]`;
    link.title = sourceLabel(source, index);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openMaterial(link.href, source.source_path);
    });
    container.appendChild(link);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
}

function appendInline(container, text, sources) {
  renderTextWithCitations(container, text, sources);
}

function renderMarkdown(container, text, sources = []) {
  container.innerHTML = "";
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) codeLines.push(lines[i++]);
      if (i < lines.length) i += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const h = document.createElement(`h${Math.min(4, heading[1].length + 1)}`);
      appendInline(h, heading[2], sources);
      container.appendChild(h);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const list = document.createElement(ordered ? "ol" : "ul");
      const itemPattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && itemPattern.test(lines[i])) {
        const li = document.createElement("li");
        appendInline(li, lines[i].replace(itemPattern, ""), sources);
        list.appendChild(li);
        i += 1;
      }
      container.appendChild(list);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) tableLines.push(lines[i++]);
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      tableLines.forEach((rowLine, rowIndex) => {
        if (rowIndex === 1) return;
        const tr = document.createElement("tr");
        rowLine.replace(/^\|/, "").replace(/\|$/, "").split("|").forEach((cell) => {
          const el = document.createElement(rowIndex === 0 ? "th" : "td");
          appendInline(el, cell.trim(), sources);
          tr.appendChild(el);
        });
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      container.appendChild(wrap);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("```") && !/^(#{1,4})\s+/.test(lines[i])) {
      if (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i])) break;
      paragraph.push(lines[i++]);
    }
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" "), sources);
    container.appendChild(p);
  }
}

function addMessage(role, text, sources = []) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant") renderMarkdown(bubble, text, sources);
  else bubble.textContent = text;
  article.appendChild(bubble);
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

function showPane(name) {
  ["chat", "script", "settings"].forEach((pane) => {
    $(`#${pane}Pane`).classList.toggle("hidden", pane !== name);
    $(`#${pane}Tab`).classList.toggle("active", pane === name);
  });
}

function renderBadges(status) {
  titleMeta.innerHTML = "";
  const sqliteVersion = status.sqlite_version || "unknown";
  const sqliteFts = status.sqlite_fts5_supported
    ? `SQLite FTS5: ON (${sqliteVersion})`
    : `SQLite FTS5: OFF (${sqliteVersion})`;
  [
    `版本 ${status.version || "unknown"}`,
    sqliteFts,
    personalLlmEnabled() ? "个人 LLM 已配置" : "本地检索模式",
  ].forEach((text) => {
    const badge = document.createElement("span");
    badge.className = "status-pill";
    badge.textContent = text;
    titleMeta.appendChild(badge);
  });
}

function manualButton(item, className = "material-link") {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = item.manual_id || item.title;
  button.title = item.source_path;
  button.addEventListener("click", () => openMaterial(item.view_url, item.source_path));
  return button;
}

function renderManualSearch(manuals = []) {
  manualCandidates = manuals;
  manualOptions.innerHTML = "";
  manuals.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.manual_id;
    option.label = `${item.title} - ${item.source_path}`;
    manualOptions.appendChild(option);
  });
}

function openManualFromSearch() {
  const query = manualSearch.value.trim().toLowerCase();
  if (!query) return;
  const item = manualCandidates.find((manual) => manual.manual_id.toLowerCase() === query)
    || manualCandidates.find((manual) => manual.manual_id.toLowerCase().includes(query) || manual.title.toLowerCase().includes(query));
  if (item) {
    manualSearch.value = item.manual_id;
    openMaterial(item.view_url, item.source_path);
  }
}

function renderMaterials(data) {
  materialsList.innerHTML = "";
  quickManuals.innerHTML = "";
  renderManualSearch(data.manuals || data.html_manuals || []);

  (data.quick_manuals || []).forEach((item) => {
    quickManuals.appendChild(manualButton(item, "quick-manual"));
  });

  if (!(data.manuals || []).length) {
    materialsList.innerHTML = '<p class="empty">暂无 raw manual 候选。管理员需要把材料放到 raw/ 后在后台运行 reindex。</p>';
    return;
  }
  if (data.default_view_url && !materialFrame.src) openMaterial(data.default_view_url, data.default_source_path);
}

async function refreshAppData() {
  const [status, materials] = await Promise.all([
    fetch("/api/status").then(readJsonResponse),
    fetch("/api/materials").then(readJsonResponse),
  ]);
  renderBadges(status);
  renderMaterials(materials);
}

async function showApp(user) {
  currentUser = user;
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  sessionMeta.textContent = `${user.username} (${user.role})`;
  addMessage("assistant", "已进入工作台。你可以在左侧切换 manual 页面，在右侧询问 manual/wiki 或注解脚本。");
  await refreshAppData();
}

async function checkSession() {
  const data = await fetch("/api/me").then(readJsonResponse);
  if (data.user) {
    await showApp(data.user);
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    if (data.bootstrap_required) {
      loginStatus.textContent = "尚未创建管理员。请先在服务器执行：python3 server.py --create-admin admin";
    }
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  try {
    const data = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("#loginUsername").value, password: $("#loginPassword").value }),
    }).then(readJsonResponse);
    await showApp(data.user);
  } catch (error) {
    loginStatus.textContent = networkErrorMessage(error);
  }
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  addMessage("user", question);
  questionInput.value = "";
  const pending = addMessage("assistant", "正在检索 wiki 和 raw materials...");
  try {
    const data = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, active_source_path: activeSourcePath, llm_config: getLlmSettings() }),
    }).then(readJsonResponse);
    pending.remove();
    addMessage("assistant", data.answer || "没有返回结果。", data.sources || []);
    refreshAppData();
  } catch (error) {
    pending.remove();
    addMessage("assistant", `请求失败：${networkErrorMessage(error)}`);
  }
});

manualSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openManualFromSearch();
});

manualSearch.addEventListener("change", openManualFromSearch);
manualSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    openManualFromSearch();
  }
});

readerSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = readerSearch.value.trim();
  if (!query || !activeSourcePath) return;
  readerSearchStatus.textContent = "正在查找当前 manual 索引文本...";
  try {
    const params = new URLSearchParams({ source_path: activeSourcePath, q: query });
    const data = await fetch(`/api/manual-search?${params.toString()}`).then(readJsonResponse);
    openMaterial(data.view_url, data.source_path);
    readerSearchStatus.textContent = `已跳到匹配页 ${data.page || "1"}。可继续用浏览器 PDF 内置查找做页内精确定位。`;
  } catch (error) {
    readerSearchStatus.textContent = `未找到：${networkErrorMessage(error)}`;
  }
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveLlmSettings({
    llm_base_url: llmBaseUrlInput.value.trim().replace(/\/$/, ""),
    llm_model: llmModelInput.value.trim() || "internal-llm",
    llm_api_key: llmApiKeyInput.value.trim(),
    llm_timeout: Number(llmTimeoutInput.value || 120),
  });
  settingsStatus.textContent = "已保存到当前浏览器。";
  refreshAppData();
});

clearSettingsBtn.addEventListener("click", () => {
  localStorage.removeItem(SETTINGS_KEY);
  applySettings();
  settingsStatus.textContent = "已清空当前浏览器 LLM 设置。";
  refreshAppData();
});

scriptFile.addEventListener("change", async () => {
  const file = scriptFile.files && scriptFile.files[0];
  if (!file) return;
  scriptText.value = await file.text();
});

chooseWorkspaceBtn.addEventListener("click", async () => {
  if ("showDirectoryPicker" in window) {
    directoryHandle = await window.showDirectoryPicker();
    annotationResult.textContent = `已选择本地目录：${directoryHandle.name}`;
  } else {
    annotationResult.textContent = "当前浏览器不支持真实目录授权，将使用浏览器本地存储。";
  }
});

saveScriptBtn.addEventListener("click", async () => {
  const content = scriptText.value;
  if (!content.trim()) return;
  if (directoryHandle) {
    const handle = await directoryHandle.getFileHandle(`script-${Date.now()}.txt`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    annotationResult.textContent = "脚本已保存到本地目录。";
  } else {
    localStorage.setItem(SCRIPT_STORE_KEY, content);
    annotationResult.textContent = "脚本已保存到浏览器本地存储。";
  }
});

annotateBtn.addEventListener("click", async () => {
  annotateBtn.disabled = true;
  annotateBtn.textContent = "注解中...";
  annotationResult.textContent = "";
  try {
    const data = await fetch("/api/annotate-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script_text: scriptText.value,
        filename: scriptFile.files && scriptFile.files[0] ? scriptFile.files[0].name : "pasted-script.txt",
        llm_config: getLlmSettings(),
      }),
    }).then(readJsonResponse);
    latestAnnotationMarkdown = data.annotation_markdown || "";
    renderMarkdown(annotationResult, latestAnnotationMarkdown, data.sources || []);
    downloadAnnotationBtn.disabled = !latestAnnotationMarkdown;
  } catch (error) {
    annotationResult.textContent = networkErrorMessage(error);
  } finally {
    annotateBtn.disabled = false;
    annotateBtn.textContent = "生成结构化注解";
  }
});

downloadAnnotationBtn.addEventListener("click", () => {
  if (!latestAnnotationMarkdown) return;
  const blob = new Blob([latestAnnotationMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "script-annotation.md";
  link.click();
  URL.revokeObjectURL(url);
});

["chat", "script", "settings"].forEach((name) => {
  $(`#${name}Tab`).addEventListener("click", () => showPane(name));
});

togglePanelBtn.addEventListener("click", () => {
  appView.classList.toggle("wide-work-panel");
});

let dragging = false;
splitter.addEventListener("mousedown", () => {
  dragging = true;
  document.body.classList.add("dragging");
});
document.addEventListener("mouseup", () => {
  dragging = false;
  document.body.classList.remove("dragging");
});
document.addEventListener("mousemove", (event) => {
  if (!dragging) return;
  const width = Math.min(Math.max(window.innerWidth - event.clientX - 18, 360), Math.min(760, window.innerWidth * 0.62));
  document.documentElement.style.setProperty("--work-width", `${width}px`);
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

applySettings();
scriptText.value = localStorage.getItem(SCRIPT_STORE_KEY) || "";
checkSession().catch((error) => {
  loginView.classList.remove("hidden");
  loginStatus.textContent = networkErrorMessage(error);
});
