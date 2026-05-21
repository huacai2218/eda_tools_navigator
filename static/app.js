const $ = (selector) => document.querySelector(selector);

const loginView = $("#loginView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const loginStatus = $("#loginStatus");
const sessionMeta = $("#sessionMeta");
const titleMeta = $("#titleMeta");
const materialsList = $("#materialsList");
const quickManuals = $("#quickManuals");
const manualSearchForm = $("#manualSearchForm");
const manualSearch = $("#manualSearch");
const manualOptions = $("#manualOptions");
const readerSearchForm = $("#readerSearchForm");
const readerSearch = $("#readerSearch");
const readerSearchStatus = $("#readerSearchStatus");
const readerSearchResults = $("#readerSearchResults");
const readerSearchPager = $("#readerSearchPager");
const readerSearchPrev = $("#readerSearchPrev");
const readerSearchNext = $("#readerSearchNext");
const readerSearchPageInfo = $("#readerSearchPageInfo");
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
const docTransForm = $("#docTransForm");
const docTransStart = $("#docTransStart");
const docTransEnd = $("#docTransEnd");
const docTransBtn = $("#docTransBtn");
const docTransStatus = $("#docTransStatus");
const docTransResult = $("#docTransResult");
const downloadAnnotationBtn = $("#downloadAnnotationBtn");
const settingsModal = $("#settingsModal");
const settingsBackdrop = $("#settingsBackdrop");
const closeSettingsBtn = $("#closeSettingsBtn");
const settingsForm = $("#settingsForm");
const clearSettingsBtn = $("#clearSettingsBtn");
const settingsStatus = $("#settingsStatus");
const llmBaseUrlInput = $("#llmBaseUrl");
const llmModelInput = $("#llmModel");
const llmApiKeyInput = $("#llmApiKey");
const llmTimeoutInput = $("#llmTimeout");
const passwordForm = $("#passwordForm");
const currentPasswordInput = $("#currentPassword");
const newPasswordInput = $("#newPassword");
const confirmPasswordInput = $("#confirmPassword");
const passwordStatus = $("#passwordStatus");
const accountBtn = $("#accountBtn");
const accountName = $("#accountName");
const accountRole = $("#accountRole");
const accountMenu = $("#accountMenu");
const accountInfo = $("#accountInfo");
const accountLoginBtn = $("#accountLoginBtn");
const accountSettingsBtn = $("#accountSettingsBtn");
const accountLogoutBtn = $("#accountLogoutBtn");

const SETTINGS_KEY = "edaToolsNavigator.llmSettings";
let currentUser = null;
let activeSourcePath = "";
let activeMaterialKind = "";
let latestAnnotationMarkdown = "";
let manualCandidates = [];
let pdfManualCandidates = [];
let readerSearchQuery = "";
let readerSearchPage = 1;
let readerSearchHasPrev = false;
let readerSearchHasNext = false;

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

function pdfNavigationUrl(url) {
  const [baseWithQuery, hash = ""] = url.split("#", 2);
  const separator = baseWithQuery.includes("?") ? "&" : "?";
  const cacheBusted = `${baseWithQuery}${separator}nav=${Date.now()}`;
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  if (!hashParams.has("zoom")) hashParams.set("zoom", "page-width");
  if (!hashParams.has("pagemode")) hashParams.set("pagemode", "bookmarks");
  return `${cacheBusted}#${hashParams.toString()}`;
}

function openMaterial(url, sourcePath = "", options = {}) {
  if (!url) return;
  const isPdf = (sourcePath || "").toLowerCase().endsWith(".pdf") || url.includes(".pdf");
  if (!isPdf) {
    if (readerSearchStatus) {
      readerSearchStatus.textContent = "中间 Manual viewer 仅显示 PDF。非 PDF 来源请在引用链接中另行打开。";
    }
    return;
  }
  activeSourcePath = sourcePath || activeSourcePath;
  const path = sourcePath || "";
  activeMaterialKind = "pdf";
  if (readerSearchStatus) {
    readerSearchStatus.textContent = activeMaterialKind === "pdf"
      ? "可查找当前 PDF 的索引文本，点击结果跳转到对应页。"
      : "当前不是 PDF，请先在左侧打开一个 PDF manual。";
  }
  if (!options.keepSearch) {
    if (readerSearchResults) readerSearchResults.innerHTML = "";
    if (readerSearchPager) readerSearchPager.classList.add("hidden");
    readerSearchQuery = "";
    readerSearchPage = 1;
  }
  const targetUrl = pdfNavigationUrl(url);
  materialFrame.src = "about:blank";
  requestAnimationFrame(() => {
    materialFrame.src = targetUrl;
  });
}

function appendCitation(container, index, sources) {
  const source = sources[index - 1];
  if (!source) {
    container.appendChild(document.createTextNode(`[${index}]`));
    return;
  }
  const link = document.createElement("a");
  link.className = "citation";
  link.href = source.source_url || `/source?chunk_id=${source.chunk_id}`;
  link.textContent = `[${index}]`;
  link.title = sourceLabel(source, index);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.addEventListener("click", (event) => {
    if ((source.source_path || "").toLowerCase().endsWith(".pdf") || link.href.includes(".pdf")) {
      event.preventDefault();
      openMaterial(link.href, source.source_path);
    }
  });
  container.appendChild(link);
}

function appendInline(container, text, sources, depth = 0) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[(\d+)\])/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const token = match[0];
    if (match[2]) {
      appendCitation(container, Number(match[2]), sources);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      if (depth < 2) appendInline(strong, token.slice(2, -2), sources, depth + 1);
      else strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
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
  ["chat", "docTrans", "script"].forEach((pane) => {
    $(`#${pane}Pane`).classList.toggle("hidden", pane !== name);
    $(`#${pane}Tab`).classList.toggle("active", pane === name);
  });
}

function openSettingsModal() {
  applySettings();
  settingsStatus.textContent = "";
  passwordStatus.textContent = "";
  passwordForm.reset();
  settingsModal.classList.remove("hidden");
  llmBaseUrlInput.focus();
}

function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

function openLoginModal() {
  loginStatus.textContent = "";
  loginView.classList.remove("hidden");
  $("#loginUsername").focus();
}

function closeAccountMenu() {
  accountMenu.classList.add("hidden");
  accountBtn.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  const willOpen = accountMenu.classList.contains("hidden");
  accountMenu.classList.toggle("hidden", !willOpen);
  accountBtn.setAttribute("aria-expanded", String(willOpen));
}

function updateAccountUi() {
  if (currentUser) {
    accountName.textContent = currentUser.username;
    accountRole.textContent = currentUser.role;
    sessionMeta.textContent = `${currentUser.username} (${currentUser.role})`;
    accountInfo.textContent = `用户：${currentUser.username} / ${currentUser.role}`;
    accountLoginBtn.classList.add("hidden");
    accountSettingsBtn.classList.remove("hidden");
    accountLogoutBtn.classList.remove("hidden");
  } else {
    accountName.textContent = "未登录";
    accountRole.textContent = "点击登录";
    sessionMeta.textContent = "未登录";
    accountInfo.textContent = "未登录";
    accountLoginBtn.classList.remove("hidden");
    accountSettingsBtn.classList.add("hidden");
    accountLogoutBtn.classList.add("hidden");
  }
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
  pdfManualCandidates = manuals;
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
  const item = pdfManualCandidates.find((manual) => manual.manual_id.toLowerCase() === query)
    || pdfManualCandidates.find((manual) => manual.manual_id.toLowerCase().includes(query)
      || manual.title.toLowerCase().includes(query)
      || manual.source_path.toLowerCase().includes(query));
  if (item) {
    manualSearch.value = item.manual_id;
    openMaterial(item.view_url, item.source_path);
  }
}

function renderReaderSearchResults(data) {
  const results = data.results || [];
  readerSearchResults.innerHTML = "";
  readerSearchPage = Number(data.page || readerSearchPage || 1);
  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    const badge = result.is_toc ? '<em>目录</em>' : "";
    button.innerHTML = `
      <strong><small>p.</small>${escapeHtml(result.page || "1")}</strong>
      ${badge}
      <span>${escapeHtml(result.excerpt || "")}</span>
    `;
    button.addEventListener("click", () => {
      openMaterial(result.view_url, result.source_path, { keepSearch: true });
      readerSearchStatus.textContent = `已跳到 p.${result.page || "1"}。`;
    });
    readerSearchResults.appendChild(button);
  });

  readerSearchHasPrev = Boolean(data.has_prev);
  readerSearchHasNext = Boolean(data.has_next);
  readerSearchPrev.disabled = !readerSearchHasPrev;
  readerSearchNext.disabled = !readerSearchHasNext;
  readerSearchPageInfo.textContent = `${data.page || 1} / ${Math.max(1, Math.ceil((data.total || 0) / (data.page_size || 6)))}`;
  readerSearchPager.classList.toggle("hidden", !results.length || (!readerSearchHasPrev && !readerSearchHasNext));
  readerSearchStatus.textContent = `找到 ${data.total || 0} 条匹配，点击结果跳转到 PDF 对应页。`;
}

async function searchCurrentPdf(page = 1) {
  const query = readerSearch.value.trim();
  if (!query) return;
  if (!activeSourcePath || activeMaterialKind !== "pdf") {
    readerSearchStatus.textContent = "请先打开一个 PDF manual。";
    return;
  }
  readerSearchQuery = query;
  readerSearchPage = page;
  readerSearchStatus.textContent = "正在查找当前 PDF 索引文本...";
  try {
    const params = new URLSearchParams({
      source_path: activeSourcePath,
      q: readerSearchQuery,
      page: String(readerSearchPage),
      page_size: "6",
    });
    const data = await fetch(`/api/manual-search?${params.toString()}`).then(readJsonResponse);
    renderReaderSearchResults(data);
  } catch (error) {
    readerSearchResults.innerHTML = "";
    readerSearchPager.classList.add("hidden");
    readerSearchStatus.textContent = `未找到：${networkErrorMessage(error)}。如 PDF 新增或变更，请先后台 reindex。`;
  }
}

function renderMaterials(data) {
  materialsList.innerHTML = "";
  quickManuals.innerHTML = "";
  renderManualSearch(data.pdf_manuals || []);

  (data.quick_manuals || []).forEach((item) => {
    quickManuals.appendChild(manualButton(item, "quick-manual"));
  });

  if (data.default_view_url && !materialFrame.src) openMaterial(data.default_view_url, data.default_source_path);
  if (!(data.pdf_manuals || []).length) {
    materialsList.innerHTML = '<p class="empty">暂无 PDF manual。管理员需要把 PDF 放到 raw/manuals/ 后在后台运行 reindex。</p>';
    return;
  }
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
  updateAccountUi();
  addMessage("assistant", "已进入工作台。左侧切换和查找 PDF manual；右侧可用 KnowQuery、DocTrans 和 CodeInterp。");
  await refreshAppData();
}

async function checkSession() {
  const data = await fetch("/api/me").then(readJsonResponse);
  if (data.user) {
    await showApp(data.user);
  } else {
    currentUser = null;
    appView.classList.remove("hidden");
    loginView.classList.remove("hidden");
    updateAccountUi();
    if (data.bootstrap_required) {
      loginStatus.textContent = "尚未创建管理员。请先在服务器执行：python3.9 server.py --create-admin admin";
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
    closeAccountMenu();
    await showApp(data.user);
  } catch (error) {
    loginStatus.textContent = networkErrorMessage(error);
  }
});

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
}

accountBtn.addEventListener("click", () => {
  if (!currentUser) openLoginModal();
  else toggleAccountMenu();
});

accountLoginBtn.addEventListener("click", () => {
  closeAccountMenu();
  openLoginModal();
});

accountSettingsBtn.addEventListener("click", () => {
  closeAccountMenu();
  openSettingsModal();
});

accountLogoutBtn.addEventListener("click", logout);

document.addEventListener("click", (event) => {
  if (!accountMenu.classList.contains("hidden") && !event.target.closest(".account-section")) {
    closeAccountMenu();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  addMessage("user", question);
  questionInput.value = "";
  const pending = addMessage("assistant", personalLlmEnabled() ? "正在创造..." : "正在检索...");
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
  searchCurrentPdf(1);
});

readerSearchPrev.addEventListener("click", () => {
  if (readerSearchHasPrev) searchCurrentPdf(Math.max(1, readerSearchPage - 1));
});

readerSearchNext.addEventListener("click", () => {
  if (readerSearchHasNext) searchCurrentPdf(readerSearchPage + 1);
});

closeSettingsBtn.addEventListener("click", closeSettingsModal);
settingsBackdrop.addEventListener("click", closeSettingsModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModal.classList.contains("hidden")) closeSettingsModal();
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

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordStatus.textContent = "";
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  if (!currentPassword || !newPassword) {
    passwordStatus.textContent = "请输入当前密码和新密码。";
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordStatus.textContent = "两次输入的新密码不一致。";
    return;
  }
  try {
    await fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }).then(readJsonResponse);
    passwordForm.reset();
    passwordStatus.textContent = "密码已修改。";
  } catch (error) {
    passwordStatus.textContent = networkErrorMessage(error);
  }
});

docTransForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  docTransResult.innerHTML = "";
  if (!activeSourcePath || activeMaterialKind !== "pdf") {
    docTransStatus.textContent = "请先在中间栏打开一个 PDF manual。";
    return;
  }
  const pageStart = Number(docTransStart.value);
  const pageEnd = Number(docTransEnd.value);
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
    docTransStatus.textContent = "请输入有效页码范围，结束页不能小于起始页。";
    return;
  }
  if (pageEnd - pageStart + 1 > 20) {
    docTransStatus.textContent = "单次最多翻译 20 页，请缩小范围。";
    return;
  }
  docTransBtn.disabled = true;
  docTransBtn.textContent = "翻译中...";
  docTransStatus.textContent = "正在读取当前 PDF 页文本并调用个人 LLM...";
  try {
    const data = await fetch("/api/translate-pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_path: activeSourcePath,
        page_start: pageStart,
        page_end: pageEnd,
        target_language: "中文",
        llm_config: getLlmSettings(),
      }),
    }).then(readJsonResponse);
    renderMarkdown(docTransResult, data.translation_markdown || "没有返回翻译内容。", data.sources || []);
    docTransStatus.textContent = `已翻译 p.${data.pages || `${pageStart}-${pageEnd}`}。`;
  } catch (error) {
    docTransStatus.textContent = networkErrorMessage(error);
  } finally {
    docTransBtn.disabled = false;
    docTransBtn.textContent = "确认";
  }
});

scriptFile.addEventListener("change", async () => {
  const file = scriptFile.files && scriptFile.files[0];
  if (!file) return;
  scriptText.value = await file.text();
});

annotateBtn.addEventListener("click", async () => {
  annotateBtn.disabled = true;
  annotateBtn.textContent = "Interpreting...";
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
    annotateBtn.textContent = "Interpreting";
  }
});

downloadAnnotationBtn.addEventListener("click", () => {
  if (!latestAnnotationMarkdown) return;
  const blob = new Blob([latestAnnotationMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "code-interp.md";
  link.click();
  URL.revokeObjectURL(url);
});

["chat", "docTrans", "script"].forEach((name) => {
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
checkSession().catch((error) => {
  loginView.classList.remove("hidden");
  loginStatus.textContent = networkErrorMessage(error);
});
