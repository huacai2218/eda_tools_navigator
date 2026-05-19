const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const questionInput = document.querySelector("#question");
const uploadForm = document.querySelector("#uploadForm");
const reindexBtn = document.querySelector("#reindexBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const clearSettingsBtn = document.querySelector("#clearSettingsBtn");
const settingsModal = document.querySelector("#settingsModal");
const statusEl = document.querySelector("#status");
const titleMeta = document.querySelector("#titleMeta");
const toolList = document.querySelector("#toolList");
const manualChart = document.querySelector("#manualChart");
const docCountEl = document.querySelector("#docCount");
const chunkCountEl = document.querySelector("#chunkCount");
const lastImportSummary = document.querySelector("#lastImportSummary");
const settingsForm = document.querySelector("#settingsForm");
const llmBaseUrlInput = document.querySelector("#llmBaseUrl");
const llmModelInput = document.querySelector("#llmModel");
const llmApiKeyInput = document.querySelector("#llmApiKey");
const llmTimeoutInput = document.querySelector("#llmTimeout");
const apiKeyHint = document.querySelector("#apiKeyHint");
const settingsStatus = document.querySelector("#settingsStatus");
const SETTINGS_KEY = "edaToolsNavigator.llmSettings";

const physicalVerificationQuestions = [
  "什么是 Calibre PERC？典型 flow 是什么？",
  "DFM Property 的语法、参数和示例用法是什么？",
  "SVRF 中 PROPERTY 和 NIPROPERTY 有什么区别？",
  "Calibre PERC 如何设置 rule checks 和 results output？",
  "Calibre RVE 中如何查看 PERC 结果？",
  "LVS 和 PERC 在验证流程中的关系是什么？",
  "DFM Property 支持哪些 property access function？",
  "Calibre PERC LDL current density check 的用途是什么？",
  "如何在 Calibre Interactive 中设置 PERC flow？",
  "PERC report 中 summary 和 detailed results 应该怎么看？"
];

function randomPhysicalVerificationQuestion() {
  return physicalVerificationQuestions[Math.floor(Math.random() * physicalVerificationQuestions.length)];
}

questionInput.placeholder = randomPhysicalVerificationQuestion();

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceLabel(source, index) {
  const page = source.page ? `, p.${source.page}` : "";
  return `[${index}] ${source.tool} / ${source.title}${page}`;
}

function renderTextWithCitations(container, text, sources) {
  const pattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const sourceIndex = Number(match[1]);
    const source = sources[sourceIndex - 1];
    if (!source) {
      container.appendChild(document.createTextNode(match[0]));
      lastIndex = pattern.lastIndex;
      continue;
    }

    const citation = document.createElement("a");
    citation.className = "citation";
    citation.href = source.source_url || `/source?chunk_id=${source.chunk_id}`;
    citation.target = "_blank";
    citation.rel = "noopener noreferrer";
    citation.textContent = `[${sourceIndex}]`;
    citation.setAttribute("aria-label", `${sourceLabel(source, sourceIndex)}，打开原文`);

    const tooltip = document.createElement("span");
    tooltip.className = "citation-tooltip";
    const label = document.createElement("strong");
    label.textContent = sourceLabel(source, sourceIndex);
    const excerpt = document.createElement("span");
    excerpt.textContent = source.excerpt || "";
    const action = document.createElement("em");
    action.className = "citation-action";
    action.textContent = source.source_path && source.source_path.toLowerCase().endsWith(".pdf") ? "点击打开并定位 PDF" : "点击打开并定位原文";
    tooltip.appendChild(label);
    tooltip.appendChild(excerpt);
    tooltip.appendChild(action);
    citation.appendChild(tooltip);
    container.appendChild(citation);

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}


async function readJsonResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = { error: `响应不是有效 JSON：${error.message}` };
  }

  if (!res.ok) {
    const message = data.error || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data;
}

function networkErrorMessage(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "无法连接后端服务。请确认 server.py 正在运行，并且当前网页地址和服务端口一致。";
  }
  return error.message;
}

function setSettingsStatus(message, isError = false) {
  if (!settingsStatus) return;
  settingsStatus.textContent = message;
  settingsStatus.classList.toggle("error", isError);
}

function defaultLlmSettings() {
  return {
    llm_base_url: "",
    llm_model: "internal-llm",
    llm_api_key: "",
    llm_timeout: 120,
  };
}

function getLlmSettings() {
  try {
    return { ...defaultLlmSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch (error) {
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
  llmTimeoutInput.value = data.llm_timeout || 120;
  llmApiKeyInput.value = data.llm_api_key || "";
  apiKeyHint.textContent = personalLlmEnabled()
    ? "当前浏览器已配置个人 LLM，后续问答会使用这组设置。"
    : "未配置完整 LLM 信息时，会使用本地检索回答。";
}

function loadSettings() {
  applySettings(getLlmSettings());
}

function openSettingsModal() {
  loadSettings();
  setSettingsStatus("");
  settingsModal.classList.remove("hidden");
  llmBaseUrlInput.focus();
}

function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

function updateDebugVisibility(debug) {
  document.querySelectorAll(".debug-only").forEach((element) => {
    element.classList.toggle("hidden", !debug);
  });
}

function updateTitleBadges(data) {
  titleMeta.innerHTML = "";
  const versionBadge = document.createElement("span");
  versionBadge.className = "status-pill";
  versionBadge.textContent = data.version ? `版本 ${data.version}` : "版本 unknown";
  const llmBadge = document.createElement("span");
  const enabled = personalLlmEnabled();
  llmBadge.className = `status-pill ${enabled ? "ok" : "off"}`;
  llmBadge.textContent = enabled ? "个人 LLM 已配置" : "本地检索模式";
  titleMeta.appendChild(versionBadge);
  titleMeta.appendChild(llmBadge);
}

function renderManualChart(toolStats = []) {
  manualChart.innerHTML = "";
  if (!toolStats.length) {
    const empty = document.createElement("p");
    empty.className = "summary-note";
    empty.textContent = "暂无 manual 数据";
    manualChart.appendChild(empty);
    return;
  }
  const maxDocs = Math.max(...toolStats.map((item) => item.documents), 1);
  toolStats.slice(0, 8).forEach((item) => {
    const row = document.createElement("div");
    row.className = "manual-row";
    const label = document.createElement("span");
    label.textContent = item.tool;
    const bar = document.createElement("div");
    bar.className = "manual-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(8, Math.round((item.documents / maxDocs) * 100))}%`;
    bar.appendChild(fill);
    const count = document.createElement("b");
    count.textContent = `${item.documents} docs / ${item.chunks} chunks`;
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(count);
    manualChart.appendChild(row);
  });
}

function normalizeTableLine(line) {
  return line.replaceAll("｜", "|").trim();
}

function isTableSeparator(line) {
  const cells = normalizeTableLine(line).replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function isPipeTableLine(line) {
  const normalized = normalizeTableLine(line);
  if (!normalized.includes("|")) return false;
  const cells = normalized.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 2 && cells.some((cell) => cell.trim().length > 0);
}

function isTableHeader(lines, index) {
  if (!isPipeTableLine(lines[index] || "")) return false;
  if (index + 1 >= lines.length) return false;
  return isTableSeparator(lines[index + 1]) || isPipeTableLine(lines[index + 1]);
}

function splitTableRow(line) {
  return normalizeTableLine(line)
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function appendInline(container, text, sources) {
  renderTextWithCitations(container, text, sources);
}

function appendParagraph(container, lines, sources) {
  const p = document.createElement("p");
  appendInline(p, lines.join(" "), sources);
  container.appendChild(p);
}

function appendList(container, lines, sources, ordered) {
  const list = document.createElement(ordered ? "ol" : "ul");
  lines.forEach((line) => {
    const li = document.createElement("li");
    const text = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
    appendInline(li, text, sources);
    list.appendChild(li);
  });
  container.appendChild(list);
}

function appendTable(container, lines, sources) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  const hasSeparator = lines.length > 1 && isTableSeparator(lines[1]);
  const headerCells = splitTableRow(lines[0]);
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerCells.forEach((cell) => {
    const th = document.createElement("th");
    appendInline(th, cell, sources);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  lines.slice(hasSeparator ? 2 : 1).forEach((line) => {
    const row = document.createElement("tr");
    splitTableRow(line).forEach((cell) => {
      const td = document.createElement("td");
      appendInline(td, cell, sources);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderMarkdown(container, text, sources = []) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
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
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
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
      const level = Math.min(4, heading[1].length + 1);
      const h = document.createElement(`h${level}`);
      appendInline(h, heading[2], sources);
      container.appendChild(h);
      i += 1;
      continue;
    }

    if (isTableHeader(lines, i)) {
      const tableLines = [lines[i]];
      i += 1;
      if (i < lines.length && isTableSeparator(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      while (i < lines.length && isPipeTableLine(lines[i]) && lines[i].trim()) {
        tableLines.push(lines[i]);
        i += 1;
      }
      appendTable(container, tableLines, sources);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i += 1;
      }
      appendList(container, listLines, sources, false);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i += 1;
      }
      appendList(container, listLines, sources, true);
      continue;
    }

    const paragraphLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !isTableHeader(lines, i) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    appendParagraph(container, paragraphLines, sources);
  }
}

function addMessage(role, text, sources = []) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "assistant") {
    renderMarkdown(bubble, text, sources);
  } else {
    bubble.textContent = text;
  }

  article.appendChild(bubble);
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

async function refreshStatus() {
  const res = await fetch("/api/status");
  const data = await readJsonResponse(res);
  if (statusEl) {
    const mode = personalLlmEnabled() ? "个人 LLM 已配置" : "本地检索模式";
    statusEl.textContent = `${data.documents} 份文档，${data.chunks} 个索引片段，${mode}`;
  }
  updateTitleBadges(data);
  updateDebugVisibility(Boolean(data.debug));
  docCountEl.textContent = data.documents;
  chunkCountEl.textContent = data.chunks;
  toolList.innerHTML = "";
  if (!data.tools.length) {
    const li = document.createElement("li");
    li.textContent = "暂无数据";
    toolList.appendChild(li);
  } else {
    data.tools.forEach((tool) => {
      const li = document.createElement("li");
      li.textContent = tool;
      toolList.appendChild(li);
    });
  }
  renderManualChart(data.tool_stats || []);
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim() || questionInput.placeholder.trim();
  if (!question) return;
  addMessage("user", question);
  questionInput.value = "";
  questionInput.placeholder = randomPhysicalVerificationQuestion();
  const pending = addMessage("assistant", "正在检索手册...");
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, llm_config: getLlmSettings() }),
    });
    const data = await readJsonResponse(res);
    pending.remove();
    addMessage("assistant", data.answer || data.error || "没有返回结果。", data.sources || []);
    refreshStatus();
  } catch (error) {
    pending.remove();
    addMessage("assistant", `请求失败：${networkErrorMessage(error)}`);
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    llm_base_url: llmBaseUrlInput.value.trim().replace(/\/$/, ""),
    llm_model: llmModelInput.value.trim() || "internal-llm",
    llm_api_key: llmApiKeyInput.value.trim(),
    llm_timeout: Number(llmTimeoutInput.value || 120),
  };
  saveLlmSettings(settings);
  applySettings(settings);
  setSettingsStatus("已保存到当前浏览器。后续问答会使用这组 LLM 设置。");
  refreshStatus();
});

settingsBtn.addEventListener("click", openSettingsModal);
closeSettingsBtn.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (event) => {
  if (event.target && event.target.hasAttribute("data-close-settings")) closeSettingsModal();
});
clearSettingsBtn.addEventListener("click", () => {
  localStorage.removeItem(SETTINGS_KEY);
  loadSettings();
  setSettingsStatus("已清空当前浏览器的 LLM 设置。后续问答会使用本地检索模式。");
  refreshStatus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModal.classList.contains("hidden")) closeSettingsModal();
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(uploadForm);
  const button = uploadForm.querySelector("button");
  button.disabled = true;
  button.textContent = "正在上传...";
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const data = await readJsonResponse(res);
    if (data.error) throw new Error(data.error);
    const indexed = data.indexed || {};
    const files = indexed.files ?? 0;
    const chunks = indexed.chunks ?? 0;
    lastImportSummary.textContent = `本次导入：保存 ${data.saved} 个文件，更新 ${files} 份文档，生成 ${chunks} 个索引片段。`;
    addMessage("assistant", `已保存 ${data.saved} 个文件，并更新 ${files} 份文档、${chunks} 个索引片段。`);
    uploadForm.reset();
    document.querySelector("#tool").value = "General";
    refreshStatus();
  } catch (error) {
    addMessage("assistant", `上传失败：${networkErrorMessage(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "上传并索引";
  }
});

reindexBtn.addEventListener("click", async () => {
  reindexBtn.disabled = true;
  reindexBtn.textContent = "重建中...";
  try {
    const res = await fetch("/api/reindex", { method: "POST" });
    const data = await readJsonResponse(res);
    lastImportSummary.textContent = `本次重建：${data.files} 份文档，${data.chunks} 个索引片段。`;
    addMessage("assistant", `索引已重建：${data.files} 份文件，${data.chunks} 个片段。`);
    refreshStatus();
  } catch (error) {
    addMessage("assistant", `重建失败：${networkErrorMessage(error)}`);
  } finally {
    reindexBtn.disabled = false;
    reindexBtn.textContent = "重建索引";
  }
});

function submitOnEnter(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof chatForm.requestSubmit === "function") {
    chatForm.requestSubmit();
  } else {
    chatForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

questionInput.addEventListener("keydown", submitOnEnter, true);
document.addEventListener("keydown", (event) => {
  if (event.target === questionInput) submitOnEnter(event);
}, true);

refreshStatus();
loadSettings();
