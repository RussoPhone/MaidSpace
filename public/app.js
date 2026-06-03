const state = {
  result: null,
  activeTab: "graph",
  graphLayout: new Map(),
  currentGraphNodes: [],
  currentGraphEdges: [],
  selectedNodeId: null,
  hoveredNodeId: null,
  expandedGroups: new Set(),
  zoom: 1,
  graphMode: "medium",
  scanProgressTimer: null,
  scanProgressStartedAt: 0,
  scanProgressPercent: 0
};

const labels = {
  isolado: "isolado",
  dicente: "dicente",
  docente: "docente",
  misto: "misto",
  dependente: "dicente",
  provedor: "docente",
  dependente_provedor: "misto",
  critico_protegido: "crítico/protegido",
  diretorio: "diretório"
  ,
  critico_protegido: "critico/protegido",
  diretorio: "diretorio",
  bloco_interdependente: "bloco interdependente"
};

const riskColors = {
  baixo: "#2f8f57",
  medio: "#d7a02c",
  alto: "#c84444",
  critico: "#7f1d1d"
};

const riskWeight = {
  critico: 4,
  alto: 3,
  medio: 2,
  baixo: 1
};

const graphModes = {
  far: {
    key: "far",
    label: "mapa",
    view: "far",
    limit: 220,
    nodeScale: 1.45,
    labels: true
  },
  medium: {
    key: "medium",
    label: "grupos",
    view: "medium",
    limit: 360,
    nodeScale: 1.12,
    labels: true
  },
  close: {
    key: "close",
    label: "arquivos",
    view: "close",
    limit: 1200,
    nodeScale: 0.9,
    labels: true
  }
};

const elements = {
  serverStatus: document.querySelector("#serverStatus"),
  rootPath: document.querySelector("#rootPath"),
  adaptiveScan: document.querySelector("#adaptiveScan"),
  saveState: document.querySelector("#saveState"),
  progressiveScan: document.querySelector("#progressiveScan"),
  includeProgramFiles: document.querySelector("#includeProgramFiles"),
  maxFiles: document.querySelector("#maxFiles"),
  maxDepth: document.querySelector("#maxDepth"),
  maxFileSize: document.querySelector("#maxFileSize"),
  scanButton: document.querySelector("#scanButton"),
  scanProgress: document.querySelector("#scanProgress"),
  progressLabel: document.querySelector("#progressLabel"),
  progressElapsed: document.querySelector("#progressElapsed"),
  progressBar: document.querySelector("#progressBar"),
  systemLogList: document.querySelector("#systemLogList"),
  exportButton: document.querySelector("#exportButton"),
  metrics: document.querySelector("#metrics"),
  graphCanvas: document.querySelector("#graphCanvas"),
  graphHint: document.querySelector("#graphHint"),
  graphFilter: document.querySelector("#graphFilter"),
  depthFilter: document.querySelector("#depthFilter"),
  zoomLabel: document.querySelector("#zoomLabel"),
  modeFar: document.querySelector("#modeFar"),
  modeMedium: document.querySelector("#modeMedium"),
  modeClose: document.querySelector("#modeClose"),
  nodeDetails: document.querySelector("#nodeDetails"),
  fileSearch: document.querySelector("#fileSearch"),
  filesTable: document.querySelector("#filesTable"),
  simulationGrid: document.querySelector("#simulationGrid"),
  areSummary: document.querySelector("#areSummary"),
  openAreModal: document.querySelector("#openAreModal"),
  closeAreModal: document.querySelector("#closeAreModal"),
  areModal: document.querySelector("#areModal"),
  areModalBody: document.querySelector("#areModalBody"),
  continuousState: document.querySelector("#continuousState"),
  depthTimeline: document.querySelector("#depthTimeline"),
  dependenciesTable: document.querySelector("#dependenciesTable"),
  cyclesList: document.querySelector("#cyclesList"),
  textReport: document.querySelector("#textReport"),
  warningsList: document.querySelector("#warningsList")
};

init();

async function init() {
  bindEvents();
  renderEmpty();
  updateAdaptiveInputs();

  try {
    const health = await fetchJson("/api/health");
    elements.rootPath.value = health.cwd;
    elements.maxFiles.value = health.defaultOptions.maxFiles;
    elements.maxDepth.value = health.defaultOptions.maxDepth;
    elements.maxFileSize.value = health.defaultOptions.maxFileSizeBytes;
    elements.adaptiveScan.checked = health.defaultOptions.adaptive !== false;
    if (elements.includeProgramFiles) {
      elements.includeProgramFiles.checked = health.defaultOptions.includeProgramFiles === true;
    }
    updateAdaptiveInputs();
    setStatus("pronto", "ok");
  } catch (error) {
    setStatus("servidor indisponível", "error");
  }
}

function bindEvents() {
  elements.scanButton.addEventListener("click", runScan);
  elements.exportButton.addEventListener("click", exportJson);
  elements.graphFilter.addEventListener("change", renderGraph);
  elements.depthFilter?.addEventListener("change", () => {
    renderGraph();
    renderFiles();
  });
  elements.fileSearch.addEventListener("input", () => {
    renderFiles();
    renderGraph();
  });
  elements.adaptiveScan.addEventListener("change", updateAdaptiveInputs);
  elements.graphCanvas.addEventListener("click", selectCanvasNode);
  elements.graphCanvas.addEventListener("mousemove", hoverCanvasNode);
  elements.graphCanvas.addEventListener("mouseleave", () => {
    if (state.hoveredNodeId) {
      state.hoveredNodeId = null;
      renderGraph();
    }
  });
  elements.graphCanvas.addEventListener("wheel", handleGraphWheel, { passive: false });
  elements.modeFar?.addEventListener("click", () => setGraphMode("far"));
  elements.modeMedium?.addEventListener("click", () => setGraphMode("medium"));
  elements.modeClose?.addEventListener("click", () => setGraphMode("close"));
  elements.openAreModal?.addEventListener("click", openAreModal);
  elements.closeAreModal?.addEventListener("click", closeAreModal);
  elements.areModal?.querySelector("[data-close-modal='are']")?.addEventListener("click", closeAreModal);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.areModal && !elements.areModal.classList.contains("is-hidden")) {
      closeAreModal();
    }
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `tab-${state.activeTab}`);
      });
      if (state.activeTab === "graph") {
        renderGraph();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (state.activeTab === "graph") {
      renderGraph();
    }
  });
}

function updateAdaptiveInputs() {
  const disabled = elements.adaptiveScan.checked;
  elements.maxFiles.disabled = disabled;
  elements.maxDepth.disabled = disabled;
  elements.maxFileSize.disabled = disabled;
}

function setGraphMode(modeKey) {
  const zoomByMode = {
    far: 0.62,
    medium: 1,
    close: 2.05
  };
  state.zoom = zoomByMode[modeKey] || 1;
  renderGraph();
}

function handleGraphWheel(event) {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 0.88;
  state.zoom = clamp(state.zoom * factor, 0.45, 2.8);
  renderGraph();
}

async function runScan() {
  const rootPath = elements.rootPath.value.trim();
  if (!rootPath) {
    setStatus("informe um diretório", "error");
    elements.rootPath.focus();
    return;
  }

  const options = elements.adaptiveScan.checked
    ? { adaptive: true }
    : {
        adaptive: false,
        maxFiles: Number(elements.maxFiles.value),
        maxDepth: Number(elements.maxDepth.value),
        maxFileSizeBytes: Number(elements.maxFileSize.value)
      };
  options.saveState = elements.saveState?.checked !== false;
  options.includeProgramFiles = elements.includeProgramFiles?.checked === true;

  if (elements.progressiveScan?.checked) {
    await runProgressiveScan(rootPath, options);
    return;
  }

  elements.scanButton.disabled = true;
  elements.exportButton.disabled = true;
  setStatus("escaneando", "busy");
  startScanProgress();
  resetSystemLog();
  appendSystemLog("A.D.D iniciado em modo normal.");

  try {
    state.result = await fetchJson("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, options })
    });
    state.selectedNodeId = null;
    elements.exportButton.disabled = false;
    syncOptionsFromResult();
    setStatus(`ok - ${state.result.summary.elapsedMs} ms`, "ok");
    finishScanProgress("ok", state.result);
    appendSystemLog(`Varredura concluida: ${formatNumber(state.result.summary.files || 0)} arquivos e ${formatBytes(state.result.summary.totalBytes || 0)} lidos.`);
    renderAll();
  } catch (error) {
    setStatus("erro na varredura", "error");
    finishScanProgress("error");
    appendSystemLog(`Erro: ${error.message}`);
    renderError(error.message);
  } finally {
    elements.scanButton.disabled = false;
  }
}

async function runProgressiveScan(rootPath, options) {
  elements.scanButton.disabled = true;
  elements.exportButton.disabled = true;
  state.result = null;
  state.selectedNodeId = null;
  state.hoveredNodeId = null;
  setStatus("varredura progressiva", "busy");
  startScanProgress("progressive");
  resetSystemLog();
  appendSystemLog("A.D.D progressivo iniciado; aguardando primeira profundidade.");
  renderEmpty();

  try {
    const response = await fetch("/api/scan-progressive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, options })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Falha HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Navegador sem suporte a leitura progressiva.");
    }

    await readProgressiveStream(response.body);
    if (state.result) {
      elements.exportButton.disabled = false;
      syncOptionsFromResult();
      finishScanProgress("ok", state.result);
      setStatus(`ok - ${state.result.summary.elapsedMs} ms`, "ok");
      appendSystemLog(`Varredura progressiva concluida: ${formatNumber(state.result.summary.files || 0)} arquivos, ${formatBytes(state.result.summary.totalBytes || 0)} analisados.`);
    }
  } catch (error) {
    setStatus("erro na varredura", "error");
    finishScanProgress("error");
    appendSystemLog(`Erro: ${error.message}`);
    renderError(error.message);
  } finally {
    elements.scanButton.disabled = false;
  }
}

async function readProgressiveStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processProgressiveLine(line);
    }
  }

  if (buffer.trim()) {
    processProgressiveLine(buffer);
  }
}

function processProgressiveLine(line) {
  if (!line.trim()) {
    return;
  }

  const event = JSON.parse(line);
  if (event.type === "error") {
    throw new Error(event.error || "Erro na varredura progressiva.");
  }
  if (event.type === "heartbeat") {
    updateHeartbeatProgress(event);
    return;
  }
  if (event.type !== "snapshot" || !event.result) {
    return;
  }

  state.result = event.result;
  updateProgressiveScanProgress(event.progress || event.result.progressive || {}, event.result);
  appendProgressiveSnapshotLog(event.progress || event.result.progressive || {}, event.result);
  renderAll();
}

function updateHeartbeatProgress(event) {
  if (!elements.scanProgress) {
    return;
  }
  const elapsedMs = Number(event.elapsedMs || 0);
  const scan = event.scan || {};
  const depthText = event.currentDepth && event.maxDepth
    ? `ultima prof. ${event.currentDepth}/${event.maxDepth}`
    : "preparando varredura";
  const scanText = scan.currentPath
    ? `${formatNumber(scan.files || 0)} arquivos vistos em ${scan.currentPath}`
    : depthText;
  elements.scanProgress.classList.remove("is-hidden");
  elements.scanProgress.dataset.mode = "busy";
  elements.progressElapsed.textContent = formatElapsed(elapsedMs);
  elements.progressLabel.textContent = `Processando: ${scanText}`;
  appendSystemLog(`Ainda processando (${scanText})... ${formatElapsed(elapsedMs)} sem novo snapshot.`);
}

function appendProgressiveSnapshotLog(progress, result) {
  const summary = result?.summary || {};
  const are = result?.relocationPlan?.spaceModes?.alto?.reallocatableHuman || "0 B";
  appendSystemLog(`Prof. ${progress.currentDepth || "?"}/${progress.maxDepth || "?"}: ${formatNumber(summary.files || 0)} arquivos, ${formatBytes(summary.totalBytes || 0)} lidos, A.R.E alto ${are}.`);
}

function syncOptionsFromResult() {
  if (!state.result?.options) {
    return;
  }
  elements.maxFiles.value = state.result.options.maxFiles;
  elements.maxDepth.value = state.result.options.maxDepth;
  elements.maxFileSize.value = state.result.options.maxFileSizeBytes;
  if (elements.includeProgramFiles) {
    elements.includeProgramFiles.checked = state.result.options.includeProgramFiles === true;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Falha HTTP ${response.status}`);
  }
  return payload;
}

function setStatus(text, mode) {
  elements.serverStatus.textContent = text;
  elements.serverStatus.dataset.mode = mode;
}

function startScanProgress(mode = "normal") {
  if (!elements.scanProgress) {
    return;
  }

  state.scanProgressStartedAt = performance.now();
  state.scanProgressPercent = 4;
  elements.scanProgress.classList.remove("is-hidden");
  elements.scanProgress.dataset.mode = "busy";
  elements.progressLabel.textContent = mode === "progressive"
    ? "Iniciando varredura progressiva"
    : "Escaneando arquivos e diretorios";
  elements.progressElapsed.textContent = "0.0s";
  elements.progressBar.style.width = "4%";

  if (state.scanProgressTimer) {
    window.clearInterval(state.scanProgressTimer);
    state.scanProgressTimer = null;
  }

  if (mode === "progressive") {
    return;
  }

  state.scanProgressTimer = window.setInterval(updateScanProgress, 180);
}

function updateScanProgress() {
  if (!elements.scanProgress || !state.scanProgressStartedAt) {
    return;
  }

  const elapsedMs = performance.now() - state.scanProgressStartedAt;
  const nextPercent = state.scanProgressPercent + Math.max(0.18, (94 - state.scanProgressPercent) * 0.018);
  state.scanProgressPercent = Math.min(94, nextPercent);
  elements.progressElapsed.textContent = formatElapsed(elapsedMs);
  elements.progressBar.style.width = `${state.scanProgressPercent.toFixed(1)}%`;
  elements.progressLabel.textContent = elapsedMs > 8000
    ? "Analisando dependencias, uso e riscos"
    : "Escaneando arquivos e diretorios";
}

function finishScanProgress(mode, result) {
  if (!elements.scanProgress) {
    return;
  }

  if (state.scanProgressTimer) {
    window.clearInterval(state.scanProgressTimer);
    state.scanProgressTimer = null;
  }

  const elapsedMs = state.scanProgressStartedAt ? performance.now() - state.scanProgressStartedAt : 0;
  elements.scanProgress.dataset.mode = mode;
  elements.progressElapsed.textContent = formatElapsed(elapsedMs);

  if (mode === "ok") {
    const summary = result?.summary || {};
    elements.progressBar.style.width = "100%";
    elements.progressLabel.textContent = `Concluido: ${formatNumber(summary.files || 0)} arquivos, ${formatNumber(summary.directories || 0)} diretorios`;
  } else {
    elements.progressLabel.textContent = "Varredura interrompida";
  }
}

function updateProgressiveScanProgress(progress, result) {
  if (!elements.scanProgress) {
    return;
  }

  const elapsedMs = state.scanProgressStartedAt ? performance.now() - state.scanProgressStartedAt : 0;
  const percent = clamp(Number(progress.percent || 0), 0, 100);
  const files = result?.summary?.files || 0;
  const edges = result?.summary?.edges || 0;
  const newNodes = Number(progress.newNodeCount || 0);
  const newHuman = progress.newHuman || "0 B";
  const depthText = `prof. ${progress.currentDepth || "?"}/${progress.maxDepth || "?"}`;
  elements.scanProgress.classList.remove("is-hidden");
  elements.scanProgress.dataset.mode = progress.isFinal ? "ok" : "busy";
  elements.progressElapsed.textContent = formatElapsed(elapsedMs);
  elements.progressBar.style.width = `${Math.max(4, percent)}%`;
  elements.progressLabel.textContent = `${depthText}: ${formatNumber(files)} arquivos, ${formatNumber(edges)} arestas, +${formatNumber(newNodes)} novos (${newHuman})`;
}

function formatElapsed(ms) {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}m ${remainingSeconds}s`;
}

function resetSystemLog() {
  if (!elements.systemLogList) {
    return;
  }
  elements.systemLogList.innerHTML = "";
}

function appendSystemLog(message) {
  if (!elements.systemLogList) {
    return;
  }

  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  item.textContent = `${time} - ${message}`;
  elements.systemLogList.prepend(item);

  while (elements.systemLogList.children.length > 80) {
    elements.systemLogList.lastElementChild.remove();
  }
}

function renderAll() {
  syncDepthFilterOptions();
  renderMetrics();
  renderGraph();
  renderFiles();
  renderSimulation();
  renderRelocationPlan();
  renderContinuousState();
  renderCycles();
  renderTextReport();
  renderDepthTimeline();
  renderDependencies();
  renderWarnings();
  renderNodeDetails();
}

function renderEmpty() {
  elements.metrics.innerHTML = metricMarkup([
    ["0", "entradas"],
    ["0", "arquivos"],
    ["0", "diretórios"],
    ["0", "arestas"],
    ["0", "alto risco"],
    ["0", "médio risco"],
    ["0", "baixo risco"],
    ["0", "candidatos"]
  ]);
  elements.filesTable.innerHTML = empty("Nenhuma varredura executada.");
  elements.dependenciesTable.innerHTML = empty("Nenhuma dependência detectada ainda.");
  elements.simulationGrid.innerHTML = "";
  if (elements.areSummary) elements.areSummary.innerHTML = empty("Execute uma varredura para calcular o A.R.E.");
  if (elements.areModalBody) elements.areModalBody.innerHTML = empty("Execute uma varredura para calcular o A.R.E.");
  if (elements.openAreModal) elements.openAreModal.disabled = true;
  if (elements.continuousState) elements.continuousState.innerHTML = "";
  if (elements.cyclesList) elements.cyclesList.innerHTML = empty("Nenhum ciclo detectado.");
  if (elements.textReport) elements.textReport.textContent = "";
  if (elements.depthTimeline) elements.depthTimeline.innerHTML = empty("Nenhuma profundidade registrada.");
  if (elements.depthFilter) elements.depthFilter.innerHTML = `<option value="all">Todas</option>`;
  elements.warningsList.innerHTML = empty("Sem avisos.");
  updateZoomLabel();
}

function renderError(message) {
  elements.metrics.innerHTML = "";
  elements.filesTable.innerHTML = empty(message);
  elements.dependenciesTable.innerHTML = empty(message);
  elements.simulationGrid.innerHTML = "";
  if (elements.areSummary) elements.areSummary.innerHTML = empty(message);
  if (elements.areModalBody) elements.areModalBody.innerHTML = empty(message);
  if (elements.openAreModal) elements.openAreModal.disabled = true;
  if (elements.continuousState) elements.continuousState.innerHTML = "";
  if (elements.cyclesList) elements.cyclesList.innerHTML = empty(message);
  if (elements.textReport) elements.textReport.textContent = message;
  if (elements.depthTimeline) elements.depthTimeline.innerHTML = empty(message);
  elements.warningsList.innerHTML = empty(message);
  clearCanvas(message);
}

function renderMetrics() {
  if (!state.result) {
    return;
  }
  const summary = state.result.summary;
  const scale = state.result.scaleEstimate?.scale || "n/d";
  elements.metrics.innerHTML = metricMarkup([
    [summary.entries, "entradas lidas"],
    [summary.cycles || 0, "ciclos"],
    [summary.files, "arquivos"],
    [summary.directories, "diretórios"],
    [summary.canDelete || 0, "pode apagar"],
    [summary.probablyUseless || 0, "inútil provável"],
    [summary.mustKeep || 0, "não apagar"],
    [summary.byRisk.critico || 0, "critico"],
    [summary.byRisk.alto || 0, "alto risco"],
    [summary.staleCandidates || summary.candidateLowRisk, `candidatos - ${scale}`]
  ]);
}

function syncDepthFilterOptions() {
  if (!elements.depthFilter || !state.result?.summary?.depthBreakdown) {
    return;
  }

  const current = elements.depthFilter.value || "all";
  const depths = state.result.summary.depthBreakdown.map((item) => String(item.depth));
  elements.depthFilter.innerHTML = [
    `<option value="all">Todas</option>`,
    ...depths.map((depth) => `<option value="${escapeHtml(depth)}">Prof. ${escapeHtml(depth)}</option>`)
  ].join("");
  elements.depthFilter.value = depths.includes(current) ? current : "all";
}

function metricMarkup(items) {
  return items.map(([value, label]) => `
    <div class="metric">
      <strong>${formatNumber(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join("");
}

function renderGraph() {
  if (!state.result) {
    clearCanvas("Execute uma varredura para renderizar o grafo.");
    return;
  }

  const canvas = elements.graphCanvas;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(300, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = rect.width;
  const height = rect.height;
  context.clearRect(0, 0, width, height);

  const mode = resolveGraphMode();
  state.graphMode = mode.key;
  const baseView = state.result.graphViews?.[mode.view] || fallbackGraphView();
  const view = buildInteractiveGraphView(baseView, mode);
  const visibleNodes = selectGraphNodes(view.nodes, mode);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const edges = view.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  state.currentGraphNodes = visibleNodes;
  state.currentGraphEdges = edges;

  elements.graphHint.textContent = `${mode.label} - ${visibleNodes.length}/${view.nodes.length} nos - ${focusText()}`;
  updateZoomLabel(mode);

  if (!visibleNodes.length) {
    clearCanvas("Nenhum nó dentro do filtro atual.");
    return;
  }

  const layout = computeImpactLayout(visibleNodes, width, height, mode);
  state.graphLayout = layout;

  drawGraphBackdrop(context, width, height);
  drawDecisionZones(context, width, height, mode);
  drawEdges(context, edges, layout);
  drawNodes(context, layout, mode);
}

function resolveGraphMode() {
  if (state.zoom < 0.82) {
    return graphModes.far;
  }
  if (state.zoom < 1.65) {
    return graphModes.medium;
  }
  return graphModes.close;
}

function updateZoomLabel(mode = resolveGraphMode()) {
  if (!elements.zoomLabel) {
    return;
  }
  elements.zoomLabel.textContent = `${mode.label} - ${Math.round(state.zoom * 100)}%`;
  elements.modeFar?.classList.toggle("is-active", mode.key === "far");
  elements.modeMedium?.classList.toggle("is-active", mode.key === "medium");
  elements.modeClose?.classList.toggle("is-active", mode.key === "close");
}

function fallbackGraphView() {
  return {
    nodes: state.result.nodes.filter((node) => node.kind === "file").map((node) => ({
      ...node,
      label: node.name || node.relativePath,
      fileCount: 1,
      directoryCount: 0,
      children: [node.id]
    })),
    edges: state.result.edges
  };
}

function buildInteractiveGraphView(baseView, mode) {
  if (!state.result || mode.key === "far") {
    return baseView;
  }

  const files = state.result.nodes.filter((node) => node.kind === "file");
  const groups = new Map();
  for (const file of files) {
    const key = groupKeyForFile(file, mode);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(file);
  }

  const nodes = [];
  const fileToVisibleNode = new Map();

  for (const [key, groupFiles] of groups.entries()) {
    const groupId = `group:${mode.key}:${key}`;
    const shouldGroup = groupFiles.length > 1 || mode.key === "medium";
    const expanded = state.expandedGroups.has(groupId);

    if (!shouldGroup) {
      const file = groupFiles[0];
      nodes.push(fileToGraphNode(file, "file"));
      fileToVisibleNode.set(file.id, file.id);
      continue;
    }

    const groupNode = buildUiGroupNode(groupId, key, groupFiles, mode, expanded);
    nodes.push(groupNode);

    if (expanded) {
      for (const file of groupFiles) {
        const child = fileToGraphNode(file, "expanded_file");
        child.parentGroupId = groupId;
        child.label = file.name;
        nodes.push(child);
        fileToVisibleNode.set(file.id, file.id);
      }
    } else {
      for (const file of groupFiles) {
        fileToVisibleNode.set(file.id, groupId);
      }
    }
  }

  return {
    ...baseView,
    nodes,
    edges: aggregateVisibleEdges(state.result.edges, fileToVisibleNode)
  };
}

function groupKeyForFile(file, mode) {
  const dir = topDirectoryFromPath(file.relativePath);
  const decision = file.deletionDecision || "averiguar";
  if (mode.key === "close") {
    return `${decision}|${dir}|${file.extension || "sem_ext"}`;
  }
  return `${decision}|${dir}`;
}

function buildUiGroupNode(groupId, key, files, mode, expanded) {
  const [decision, dir, extension] = key.split("|");
  const labelParts = mode.key === "close"
    ? [decisionLabel(decision), dir, extension || "sem ext"]
    : [decisionLabel(decision), dir];
  const incoming = files.reduce((sum, file) => sum + (file.incoming || 0), 0);
  const outgoing = files.reduce((sum, file) => sum + (file.outgoing || 0), 0);
  const impactCount = files.reduce((sum, file) => sum + (file.impactCount || 0), 0);
  const size = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const dominantFile = files
    .slice()
    .sort((a, b) => dependencyScore(b) - dependencyScore(a) || String(a.name).localeCompare(String(b.name)))[0];

  return {
    id: groupId,
    kind: "ui_group",
    label: `${labelParts.filter(Boolean).join(" - ")} (${files.length})`,
    name: labelParts.filter(Boolean).join(" - "),
    relativePath: dir,
    extension: extension || "",
    risk: maxRiskClient(files),
    classification: "grupo",
    fileCount: files.length,
    directoryCount: new Set(files.map((file) => topDirectoryFromPath(file.relativePath))).size,
    scanDepth: Math.max(0, ...files.map((file) => Number(file.scanDepth ?? 0))),
    scanDepths: Array.from(new Set(files.map((file) => Number(file.scanDepth ?? 0)))).sort((a, b) => a - b),
    incoming,
    outgoing,
    impactCount,
    dependencyScore: files.reduce((sum, file) => sum + dependencyScore(file), 0),
    dominantFileName: dominantFile?.name || dominantFile?.relativePath || "",
    depth: Math.max(0, ...files.map((file) => file.depth || 0)),
    size,
    daysSinceAccess: Math.min(...files.map((file) => Number(file.daysSinceAccess ?? 9999))),
    deletionDecision: aggregateDeletionDecisionClient(files),
    utilityStatus: aggregateUtilityStatusClient(files),
    action: expanded ? "grupo_expandido" : "clique_para_expandir",
    children: files.map((file) => file.id),
    searchText: files.map((file) => file.relativePath).join(" "),
    expanded,
    groupReason: expanded ? "grupo aberto" : "grupo expansível"
  };
}

function fileToGraphNode(file, kind) {
  return {
    ...file,
    kind,
    label: file.name || file.relativePath,
    dependencyScore: dependencyScore(file),
    dominantFileName: file.name || file.relativePath,
    fileCount: 1,
    directoryCount: 0,
    children: [file.id],
    action: file.simulationAction
  };
}

function aggregateVisibleEdges(edges, fileToVisibleNode) {
  const aggregate = new Map();
  for (const edge of edges) {
    const source = fileToVisibleNode.get(edge.source);
    const target = fileToVisibleNode.get(edge.target);
    if (!source || !target || source === target) {
      continue;
    }
    const key = `${source}->${target}`;
    if (!aggregate.has(key)) {
      aggregate.set(key, {
        id: key,
        source,
        target,
        weight: 0,
        types: {},
        samples: []
      });
    }
    const item = aggregate.get(key);
    item.weight += 1;
    item.types[edge.type] = (item.types[edge.type] || 0) + 1;
    if (item.samples.length < 4) {
      item.samples.push(edge);
    }
  }
  return Array.from(aggregate.values());
}

function selectGraphNodes(nodes, mode) {
  const filter = elements.graphFilter.value;
  const depthFilter = elements.depthFilter?.value || "all";
  const query = elements.fileSearch.value.trim().toLowerCase();
  return nodes
    .filter((node) => filter === "all" || node.risk === filter)
    .filter((node) => depthFilter === "all" || nodeMatchesDepth(node, depthFilter))
    .filter((node) => {
      if (!query) {
        return true;
      }
      const haystack = [
        node.label,
        node.name,
        node.relativePath,
        node.searchText,
        ...(node.children || [])
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const scoreA = riskWeight[a.risk] * 1000 + (a.incoming + a.outgoing) * 12 + (a.fileCount || 1) + a.depth * 4;
      const scoreB = riskWeight[b.risk] * 1000 + (b.incoming + b.outgoing) * 12 + (b.fileCount || 1) + b.depth * 4;
      return scoreB - scoreA || String(a.label).localeCompare(String(b.label));
    })
    .slice(0, mode.limit);
}

function nodeMatchesDepth(node, depthFilter) {
  const depth = Number(depthFilter);
  if (!Number.isFinite(depth)) {
    return true;
  }
  if (Array.isArray(node.scanDepths)) {
    return node.scanDepths.includes(depth);
  }
  return Number(node.scanDepth ?? 0) === depth;
}

function focusText() {
  const focused = state.hoveredNodeId || state.selectedNodeId;
  if (!focused) {
    return "visão limpa";
  }
  const node = state.currentGraphNodes.find((item) => item.id === focused);
  return node ? `foco: ${trimLabel(node.label || node.relativePath, 28)}` : "foco ativo";
}

function computeImpactLayout(nodes, width, height, mode) {
  const layout = new Map();
  const zones = decisionZones(width, height);
  const grouped = new Map();

  for (const node of nodes) {
    const key = zoneKeyFor(node);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(node);
  }

  for (const [key, groupNodes] of grouped.entries()) {
    const zone = zones[key] || zones.averiguar;
    groupNodes.sort((a, b) => {
      const scoreA = (a.fileCount || 1) + (a.impactCount || 0) * 2 + (a.incoming || 0) * 3;
      const scoreB = (b.fileCount || 1) + (b.impactCount || 0) * 2 + (b.incoming || 0) * 3;
      return scoreB - scoreA || String(a.label).localeCompare(String(b.label));
    });

    groupNodes.forEach((node, index) => {
      const spiral = Math.sqrt(index + 1) / Math.sqrt(groupNodes.length + 1);
      const angle = index * 2.399963 + hashNumber(node.id) * 0.0008;
      const jitter = mode.key === "close" ? 1.05 : mode.key === "far" ? 0.72 : 0.88;
      const x = zone.x + Math.cos(angle) * zone.rx * spiral * jitter;
      const y = zone.y + Math.sin(angle) * zone.ry * spiral * jitter;
      const degree = (node.incoming || 0) + (node.outgoing || 0) + (node.impactCount || 0);
      const mass = Math.max(1, node.fileCount || 1);
      const radius = clamp((5 + Math.sqrt(degree + mass) * 2.4) * mode.nodeScale, mode.key === "close" ? 4 : 8, mode.key === "far" ? 36 : 24);

      layout.set(node.id, {
        x: clamp(x, radius + 16, width - radius - 16),
        y: clamp(y, radius + 16, height - radius - 16),
        radius,
        node,
        zoneKey: key
      });
    });
  }

  return layout;
}

function decisionZones(width, height) {
  return {
    pode_apagar: { x: width * 0.22, y: height * 0.7, rx: width * 0.16, ry: height * 0.18, label: "pode apagar", color: "#2f8f57" },
    inutil_provavel: { x: width * 0.26, y: height * 0.32, rx: width * 0.16, ry: height * 0.18, label: "inútil provável", color: "#84a94f" },
    averiguar: { x: width * 0.56, y: height * 0.48, rx: width * 0.19, ry: height * 0.24, label: "averiguar", color: "#d7a02c" },
    nao_apagar: { x: width * 0.82, y: height * 0.48, rx: width * 0.15, ry: height * 0.28, label: "não apagar", color: "#c84444" }
  };
}

function zoneKeyFor(node) {
  return node.deletionDecision || node.relocationDecision || "averiguar";
}

function drawGraphBackdrop(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7faf8");
  gradient.addColorStop(0.5, "#ffffff");
  gradient.addColorStop(1, "#f3f6f7");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.45;
  context.strokeStyle = "rgba(35, 43, 47, 0.06)";
  context.lineWidth = 1;
  const step = 42;
  for (let x = 0; x < width; x += step) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += step) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawDecisionZones(context, width, height) {
  const zones = decisionZones(width, height);
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const zone of Object.values(zones)) {
    const gradient = context.createRadialGradient(zone.x, zone.y, 6, zone.x, zone.y, Math.max(zone.rx, zone.ry));
    gradient.addColorStop(0, hexToRgba(zone.color, 0.13));
    gradient.addColorStop(1, hexToRgba(zone.color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(zone.x, zone.y, zone.rx, zone.ry, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = hexToRgba(zone.color, 0.7);
    context.font = "800 12px Segoe UI, sans-serif";
    context.fillText(zone.label, zone.x, zone.y - zone.ry - 12);
  }
  context.restore();
}

function drawEdges(context, edges, layout) {
  const focusId = state.hoveredNodeId || state.selectedNodeId;
  context.save();
  for (const edge of edges) {
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const focused = focusId && (edge.source === focusId || edge.target === focusId);
    const important = !focusId && Math.max(edge.weight || 1, source.node.impactCount || 0, target.node.impactCount || 0) >= 3;
    if (!focused && !important) {
      continue;
    }

    const weight = Math.max(1, edge.weight || 1);
    context.beginPath();
    context.strokeStyle = edgeColor(source.node.risk, target.node.risk, weight, focused);
    context.lineWidth = focused ? clamp(1.4 + Math.sqrt(weight), 1.6, 5) : clamp(0.8 + Math.sqrt(weight) * 0.35, 0.8, 2.4);
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
    if (focused) {
      drawArrowHead(context, source, target);
    }
  }
  context.restore();
}

function drawArrowHead(context, source, target) {
  const angle = Math.atan2(target.y - source.y, target.x - source.x);
  const size = 6;
  const x = target.x - Math.cos(angle) * (target.radius + 2);
  const y = target.y - Math.sin(angle) * (target.radius + 2);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - Math.cos(angle - 0.45) * size, y - Math.sin(angle - 0.45) * size);
  context.lineTo(x - Math.cos(angle + 0.45) * size, y - Math.sin(angle + 0.45) * size);
  context.closePath();
  context.fillStyle = context.strokeStyle;
  context.fill();
}

function drawNodes(context, layout, mode) {
  const focusId = state.hoveredNodeId || state.selectedNodeId;
  const topLabelIds = topDependencyLabelIds(layout, mode);
  context.save();
  for (const point of layout.values()) {
    const node = point.node;
    const focused = node.id === focusId;
    const selected = node.id === state.selectedNodeId;
    const dim = focusId && !focused && !isConnectedToFocus(node.id);

    context.globalAlpha = dim ? 0.28 : 1;
    context.beginPath();
    context.fillStyle = riskColors[node.risk] || "#81878b";
    context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = selected ? 4 : focused ? 3 : 1.4;
    context.strokeStyle = selected || focused ? "#182025" : "rgba(255, 255, 255, 0.92)";
    context.stroke();

    if ((node.fileCount > 1 || node.kind === "ui_group") && (mode.key !== "close" || focused || node.kind === "ui_group")) {
      context.fillStyle = "#ffffff";
      context.font = "800 11px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(node.expanded ? "−" : formatCompact(node.fileCount), point.x, point.y);
    }
  }
  context.globalAlpha = 1;

  for (const point of layout.values()) {
    const node = point.node;
    const focused = node.id === focusId;
    const showLabel = focused || node.id === state.selectedNodeId || topLabelIds.has(node.id);
    if (showLabel) {
      drawNodeLabel(context, point, mode, { compact: topLabelIds.has(node.id) && !focused });
    }
  }
  context.restore();
}

function drawNodeLabel(context, point, mode, options = {}) {
  const labelSource = options.compact
    ? point.node.dominantFileName || point.node.label || point.node.relativePath
    : point.node.label || point.node.dominantFileName || point.node.relativePath;
  const label = trimLabel(labelSource || "nó", mode.key === "close" ? 30 : 24);
  context.font = mode.key === "close" ? "12px Cascadia Mono, Consolas, monospace" : "800 12px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  const labelWidth = Math.min(210, context.measureText(label).width + 14);
  const labelHeight = 20;
  const x = point.x - labelWidth / 2;
  const y = point.y + point.radius + 7;
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  roundRect(context, x, y, labelWidth, labelHeight, 6);
  context.fill();
  context.strokeStyle = "rgba(28, 34, 38, 0.12)";
  context.stroke();
  context.fillStyle = "#1c2226";
  context.fillText(label, point.x, y + 3);
}

function importantNode(node) {
  return node.risk === "critico" || node.risk === "alto" || node.deletionDecision === "pode_apagar" || (node.impactCount || 0) >= 4;
}

function topDependencyLabelIds(layout, mode) {
  const maxLabels = mode.key === "far" ? 3 : mode.key === "medium" ? 5 : 8;
  return new Set(
    Array.from(layout.values())
      .filter((point) => dependencyScore(point.node) > 0)
      .sort((a, b) => dependencyScore(b.node) - dependencyScore(a.node))
      .slice(0, maxLabels)
      .map((point) => point.node.id)
  );
}

function dependencyScore(node) {
  return Number(node.dependencyScore ?? ((node.incoming || 0) * 3 + (node.outgoing || 0) * 2 + (node.impactCount || 0) * 4));
}

function topDirectoryFromPath(relativePath) {
  const normalized = String(relativePath || ".").replace(/\\/g, "/");
  if (!normalized || normalized === "." || !normalized.includes("/")) {
    return ".";
  }
  return normalized.split("/")[0];
}

function maxRiskClient(files) {
  if (files.some((file) => file.risk === "critico")) {
    return "critico";
  }
  if (files.some((file) => file.risk === "alto")) {
    return "alto";
  }
  if (files.some((file) => file.risk === "medio")) {
    return "medio";
  }
  return "baixo";
}

function aggregateDeletionDecisionClient(files) {
  if (files.some((file) => file.deletionDecision === "nao_apagar")) {
    return "nao_apagar";
  }
  if (files.some((file) => file.deletionDecision === "averiguar")) {
    return "averiguar";
  }
  if (files.some((file) => file.deletionDecision === "inutil_provavel")) {
    return "inutil_provavel";
  }
  return "pode_apagar";
}

function aggregateUtilityStatusClient(files) {
  const statuses = new Set(files.map((file) => file.utilityStatus));
  if (statuses.has("sistema")) return "sistema";
  if (statuses.has("protegido")) return "protegido";
  if (statuses.has("dependencia_relevante")) return "dependencia_relevante";
  if (statuses.has("usado_pelo_usuario")) return "usado_pelo_usuario";
  if (statuses.has("utilidade_incerta")) return "utilidade_incerta";
  if (statuses.has("baixo_uso")) return "baixo_uso";
  return "inutil_provavel";
}

function isConnectedToFocus(nodeId) {
  const focusId = state.hoveredNodeId || state.selectedNodeId;
  if (!focusId || nodeId === focusId) {
    return true;
  }
  return state.currentGraphEdges.some((edge) => {
    return (edge.source === focusId && edge.target === nodeId) || (edge.target === focusId && edge.source === nodeId);
  });
}

function edgeColor(sourceRisk, targetRisk, weight, focused = false) {
  const risk = riskWeight[sourceRisk] >= riskWeight[targetRisk] ? sourceRisk : targetRisk;
  const color = riskColors[risk] || "#60676c";
  const alpha = focused ? 0.66 : clamp(0.12 + weight * 0.04, 0.14, 0.32);
  return hexToRgba(color, alpha);
}

function clearCanvas(message) {
  const canvas = elements.graphCanvas;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawGraphBackdrop(context, rect.width || canvas.width, rect.height || canvas.height);
  context.fillStyle = "#626a70";
  context.font = "14px Segoe UI, sans-serif";
  context.fillText(message, 18, 32);
  elements.graphHint.textContent = message;
  state.graphLayout = new Map();
  state.currentGraphNodes = [];
  state.currentGraphEdges = [];
}

function hoverCanvasNode(event) {
  if (!state.graphLayout.size) {
    return;
  }
  const point = nearestCanvasPoint(event);
  const nextHoverId = point ? point.node.id : null;
  elements.graphCanvas.style.cursor = point ? "pointer" : "grab";
  if (state.hoveredNodeId !== nextHoverId) {
    state.hoveredNodeId = nextHoverId;
    renderGraph();
  }
}

function selectCanvasNode(event) {
  if (!state.graphLayout.size) {
    return;
  }
  const nearest = nearestCanvasPoint(event);
  if (nearest) {
    state.selectedNodeId = nearest.node.id;
    if (nearest.node.kind === "ui_group") {
      if (state.expandedGroups.has(nearest.node.id)) {
        state.expandedGroups.delete(nearest.node.id);
      } else {
        state.expandedGroups.add(nearest.node.id);
      }
    }
    renderNodeDetails();
    renderGraph();
  }
}

function nearestCanvasPoint(event) {
  const rect = elements.graphCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of state.graphLayout.values()) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  return nearest && nearestDistance <= nearest.radius + 12 ? nearest : null;
}

function renderNodeDetails() {
  const graphNode = state.currentGraphNodes.find((item) => item.id === state.selectedNodeId);
  const fileNode = state.result?.nodes.find((item) => item.id === state.selectedNodeId);
  const node = graphNode || fileNode;
  if (!node) {
    elements.nodeDetails.innerHTML = `
      <h2>Nó selecionado</h2>
      <p class="muted">Clique em um nó do grafo ou em uma linha da tabela.</p>
    `;
    return;
  }

  const childFiles = (node.children || [])
    .map((id) => state.result.nodes.find((item) => item.id === id))
    .filter(Boolean);
  const samples = childFiles.slice(0, 8).map((item) => item.relativePath).join("; ");
  const reasons = node.protectedReasons?.length ? node.protectedReasons.join(", ") : node.groupReason || "sem proteção especial";
  const riskReasons = node.riskReasons?.length ? node.riskReasons.join("; ") : reasons;
  const unresolved = node.unresolvedSpecifiers?.length
    ? node.unresolvedSpecifiers.map((item) => `${item.type}: ${item.specifier}`).join("; ")
    : "nenhuma";

  elements.nodeDetails.innerHTML = `
    <h2>${escapeHtml(node.label || node.name || node.relativePath)}</h2>
    <dl>
      <dt>visão</dt><dd>${escapeHtml(graphModes[state.graphMode]?.label || "arquivo")}</dd>
      <dt>caminho</dt><dd>${escapeHtml(node.relativePath || "-")}</dd>
      <dt>classe</dt><dd>${escapeHtml(labels[node.classification] || node.classification || "-")}</dd>
      <dt>risco</dt><dd>${riskMarkup(node.risk)}</dd>
      <dt>apagar</dt><dd>${escapeHtml(decisionLabel(node.deletionDecision))}</dd>
      <dt>utilidade</dt><dd>${escapeHtml(utilityLabel(node.utilityStatus))}</dd>
      <dt>sistema</dt><dd>${escapeHtml(impactLabel(node.impact?.system))}</dd>
      <dt>usuário</dt><dd>${escapeHtml(impactLabel(node.impact?.user))}</dd>
      <dt>deps</dt><dd>${escapeHtml(impactLabel(node.impact?.dependencies))}</dd>
      <dt>arquivos</dt><dd>${formatNumber(node.fileCount || 1)}</dd>
      <dt>diretórios</dt><dd>${formatNumber(node.directoryCount || 0)}</dd>
      <dt>entrada</dt><dd>${formatNumber(node.incoming || 0)}</dd>
      <dt>saída</dt><dd>${formatNumber(node.outgoing || 0)}</dd>
      <dt>impacto</dt><dd>${formatNumber(node.impactCount || 0)}</dd>
      <dt>score</dt><dd>${formatNumber(node.riskScore || 0)}</dd>
      <dt>profundidade</dt><dd>${formatNumber(node.depth || 0)}</dd>
      <dt>tamanho</dt><dd>${formatBytes(node.size || 0)}</dd>
      <dt>último uso</dt><dd>${formatAccess(node.daysSinceAccess)}</dd>
      <dt>ação</dt><dd>${escapeHtml(node.action || node.simulationAction || "-")}</dd>
      <dt>motivo</dt><dd>${escapeHtml(riskReasons)}</dd>
      <dt>pendências</dt><dd>${escapeHtml(unresolved)}</dd>
      <dt>amostra</dt><dd>${escapeHtml(samples || "-")}</dd>
    </dl>
  `;
}

function renderFiles() {
  if (!state.result) {
    return;
  }

  const query = elements.fileSearch.value.trim().toLowerCase();
  const depthFilter = elements.depthFilter?.value || "all";
  const rows = state.result.nodes
    .filter((node) => node.kind === "file")
    .filter((node) => depthFilter === "all" || nodeMatchesDepth(node, depthFilter))
    .filter((node) => !query || node.relativePath.toLowerCase().includes(query))
    .sort((a, b) => {
      const riskDiff = riskWeight[b.risk] - riskWeight[a.risk];
      return riskDiff || b.incoming - a.incoming || a.relativePath.localeCompare(b.relativePath);
    })
    .slice(0, 1000);

  if (!rows.length) {
    elements.filesTable.innerHTML = empty("Nenhum arquivo encontrado no filtro.");
    return;
  }

  elements.filesTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Risco</th>
          <th>Apagar</th>
          <th>Utilidade</th>
          <th>Classe</th>
          <th>Entrada</th>
          <th>Saída</th>
          <th>Impacto</th>
          <th>Prof.</th>
          <th>Último uso</th>
          <th>Tamanho</th>
          <th>Caminho</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((node) => `
          <tr data-node-id="${escapeHtml(node.id)}">
            <td>${riskMarkup(node.risk)}</td>
            <td>${escapeHtml(decisionLabel(node.deletionDecision))}</td>
            <td>${escapeHtml(utilityLabel(node.utilityStatus))}</td>
            <td>${escapeHtml(labels[node.classification] || node.classification)}</td>
            <td>${formatNumber(node.incoming || 0)}</td>
            <td>${formatNumber(node.outgoing || 0)}</td>
            <td>${formatNumber(node.impactCount || 0)}</td>
            <td>${formatNumber(node.depth || 0)}</td>
            <td>${formatAccess(node.daysSinceAccess)}</td>
            <td>${formatBytes(node.size || 0)}</td>
            <td class="path-cell">${escapeHtml(node.relativePath)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  elements.filesTable.querySelectorAll("tr[data-node-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.zoom = 1.9;
      state.selectedNodeId = row.dataset.nodeId;
      renderNodeDetails();
      renderGraph();
    });
  });
}

function renderSimulation() {
  if (!state.result) {
    return;
  }

  const groups = [
    ["pode_apagar", "Pode apagar", "não afeta sistema nem dependências relevantes"],
    ["inutil_provavel", "Inútil provável", "baixo uso, baixo impacto, bom candidato"],
    ["averiguar", "Averiguar", "incerteza, uso ou dependência moderada"],
    ["nao_apagar", "Não apagar", "sistema, uso recente ou impacto alto"]
  ];
  const decisions = state.result.simulation?.decisionGroups || buildDecisionGroupsFromNodes(state.result.nodes || []);

  elements.simulationGrid.innerHTML = groups.map(([key, title, subtitle]) => {
    const items = decisions[key] || [];
    return `
      <article class="bucket">
        <h3>${escapeHtml(title)} - ${formatNumber(items.length)}</h3>
        <p class="muted">${escapeHtml(subtitle)}</p>
        ${items.length ? `
          <ol>
            ${items.slice(0, 24).map((item) => `
              <li>
                ${escapeHtml(item.path)}
                <span class="muted">${escapeHtml(item.reason)}</span>
              </li>
            `).join("")}
          </ol>
        ` : `<p class="muted">Nenhum item.</p>`}
      </article>
    `;
  }).join("");
}

function buildDecisionGroupsFromNodes(nodes) {
  const groups = {
    pode_apagar: [],
    inutil_provavel: [],
    averiguar: [],
    nao_apagar: []
  };

  for (const node of nodes.filter((item) => item.kind === "file")) {
    const key = groups[node.deletionDecision] ? node.deletionDecision : "averiguar";
    groups[key].push({
      path: node.relativePath,
      reason: (node.riskReasons || []).join(", ") || node.utilityStatus || "classificacao por metadados"
    });
  }

  for (const items of Object.values(groups)) {
    items.sort((a, b) => a.path.localeCompare(b.path));
  }

  return groups;
}

function renderRelocationPlan() {
  if (!state.result || !elements.areSummary || !elements.areModalBody) {
    return;
  }

  const plan = state.result.relocationPlan;
  if (!plan) {
    elements.areSummary.innerHTML = empty("Plano A.R.E indisponivel.");
    elements.areModalBody.innerHTML = empty("Plano A.R.E indisponivel.");
    if (elements.openAreModal) elements.openAreModal.disabled = true;
    return;
  }

  if (elements.openAreModal) elements.openAreModal.disabled = false;
  elements.areSummary.innerHTML = renderAreSummary(plan);
  elements.areModalBody.innerHTML = renderAreModal(plan);
  elements.areSummary.querySelectorAll("[data-open-are-modal]").forEach((button) => {
    button.addEventListener("click", openAreModal);
  });
}

function renderAreSummary(plan) {
  const modes = ["baixo", "medio", "alto"];
  return `
    <div class="are-summary-grid">
      ${modes.map((modeKey) => {
        const mode = plan.spaceModes?.[modeKey] || {};
        return `
          <button class="are-summary-card" type="button" data-open-are-modal>
            <span>${escapeHtml(modeLabel(modeKey))}</span>
            <strong>${escapeHtml(mode.reallocatableHuman || "0 B")}</strong>
            <small>${formatNumber(mode.packageCount || 0)} pacote(s) simulados</small>
          </button>
        `;
      }).join("")}
      <button class="are-summary-card are-summary-card-blocked" type="button" data-open-are-modal>
        <span>Bloqueados</span>
        <strong>${escapeHtml(plan.summary?.blockedHuman || "0 B")}</strong>
        <small>${formatNumber(plan.blockedFiles?.length || 0)} arquivo(s)</small>
      </button>
    </div>
  `;
}

function renderAreModal(plan) {
  const modes = ["baixo", "medio", "alto"];
  return `
    ${renderAreSimulation(plan)}
    ${renderAreDepthBreakdown(plan)}
    <section class="are-modal-summary">
      ${modes.map((modeKey) => {
        const mode = plan.spaceModes?.[modeKey] || {};
        const simulation = plan.relocationSimulation?.[modeKey] || {};
        return `
          <article class="are-mode-total are-mode-${escapeHtml(modeKey)}">
            <span>${escapeHtml(modeLabel(modeKey))}</span>
            <strong>${escapeHtml(mode.reallocatableHuman || "0 B")}</strong>
            <small>${formatNumber(mode.packageCount || 0)} pacote(s) / depois: ${escapeHtml(simulation.remainingHuman || "0 B")}</small>
          </article>
        `;
      }).join("")}
      <article class="are-mode-total are-mode-blocked">
        <span>Bloqueados</span>
        <strong>${escapeHtml(plan.summary?.blockedHuman || "0 B")}</strong>
        <small>${formatNumber(plan.blockedFiles?.length || 0)} arquivo(s)</small>
      </article>
    </section>
    <section class="are-safety-report">
      <h3>Relatorio de seguranca</h3>
      <p>${escapeHtml(plan.safetyReport?.text || "Sem relatorio.")}</p>
    </section>
    ${modes.map((modeKey) => renderAreMode(plan.spaceModes?.[modeKey], modeKey)).join("")}
    ${renderBlockedFiles(plan.blockedFiles || [])}
  `;
}

function renderAreDepthBreakdown(plan) {
  const depths = plan.depthRelocation || [];
  if (!depths.length) {
    return "";
  }

  return `
    <section class="are-simulation-board">
      <div class="are-section-heading">
        <div>
          <h3>Realocacao por profundidade</h3>
          <p class="muted">Cada linha soma a camada lida pelo A.D.D; o total do A.R.E usa todas as camadas acumuladas.</p>
        </div>
      </div>
      <div class="table-wrap are-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prof.</th>
              <th>Arquivos</th>
              <th>Total lido</th>
              <th>Baixo</th>
              <th>Medio</th>
              <th>Alto</th>
              <th>Bloqueado</th>
            </tr>
          </thead>
          <tbody>
            ${depths.map((item) => `
              <tr>
                <td>${escapeHtml(item.depth)}</td>
                <td>${formatNumber(item.files || 0)}</td>
                <td>${escapeHtml(item.totalHuman || "0 B")}</td>
                <td>${escapeHtml(item.reallocatableHuman?.baixo || "0 B")}</td>
                <td>${escapeHtml(item.reallocatableHuman?.medio || "0 B")}</td>
                <td>${escapeHtml(item.reallocatableHuman?.alto || "0 B")}</td>
                <td>${escapeHtml(item.blockedHuman || "0 B")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAreSimulation(plan) {
  const modes = ["baixo", "medio", "alto"];
  return `
    <section class="are-simulation-board">
      <div class="are-section-heading">
        <div>
          <h3>Simulacao de realocacao</h3>
          <p class="muted">Mostra quanto sairia do diretorio principal se o usuario confirmasse a realocacao.</p>
        </div>
      </div>
      <div class="are-simulation-grid">
        ${modes.map((modeKey) => {
          const simulation = plan.relocationSimulation?.[modeKey] || {};
          const percent = clamp(Number(simulation.relocatedPercent || 0), 0, 100);
          return `
            <article class="are-simulation-card">
              <div class="are-simulation-head">
                <strong>${escapeHtml(modeLabel(modeKey))}</strong>
                <span>${escapeHtml(simulation.relocatedHuman || "0 B")}</span>
              </div>
              <div class="space-bar" aria-label="Espaco realocado em ${escapeHtml(modeKey)}">
                <span style="width: ${percent}%"></span>
              </div>
              <dl>
                <dt>antes</dt><dd>${escapeHtml(simulation.beforeHuman || "0 B")}</dd>
                <dt>realocado</dt><dd>${escapeHtml(simulation.relocatedHuman || "0 B")}</dd>
                <dt>depois</dt><dd>${escapeHtml(simulation.remainingHuman || "0 B")}</dd>
                <dt>pacotes</dt><dd>${formatNumber(simulation.packageCount || 0)}</dd>
              </dl>
              <p class="muted">${escapeHtml(simulation.explanation || "")}</p>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderAreMode(mode, modeKey) {
  const candidates = mode?.candidates || [];
  return `
    <section class="are-mode-section">
      <div class="are-section-heading">
        <div>
          <h3>${escapeHtml(modeLabel(modeKey))} - ${escapeHtml(mode?.reallocatableHuman || "0 B")}</h3>
          <p class="muted">${escapeHtml(mode?.description || "")}</p>
        </div>
        <span class="risk ${escapeHtml(modeRiskClass(modeKey))}">${escapeHtml(modeKey)}</span>
      </div>
      <ul class="are-criteria-list">
        ${(mode?.criteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      ${renderArePackageTable(mode?.packages || [])}
      ${renderAreCandidateTable(candidates)}
    </section>
  `;
}

function renderArePackageTable(packages) {
  if (!packages.length) {
    return empty("Nenhum pacote simulado neste nivel.");
  }
  return `
    <div class="table-wrap are-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pacote simulado</th>
            <th>Espaco</th>
            <th>Arquivos</th>
            <th>Destino simulado</th>
            <th>Justificativa</th>
          </tr>
        </thead>
        <tbody>
          ${packages.slice(0, 60).map((item) => `
            <tr>
              <td class="path-cell">${escapeHtml(item.files[0] || item.id)}</td>
              <td>${escapeHtml(item.human || formatBytes(item.bytes || 0))}</td>
              <td>${formatNumber(item.fileCount || 0)}</td>
              <td>${escapeHtml(item.targetDirectory || "-")}</td>
              <td>${escapeHtml(item.justification || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAreCandidateTable(candidates) {
  if (!candidates.length) {
    return empty("Nenhum candidato neste nivel.");
  }
  return `
    <div class="table-wrap are-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Arquivo</th>
            <th>Pacote</th>
            <th>Classe</th>
            <th>Risco</th>
            <th>Ult. acesso</th>
            <th>Ult. mod.</th>
            <th>Justificativa</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.slice(0, 80).map((item) => `
            <tr>
              <td class="path-cell">${escapeHtml(item.path)}</td>
              <td>${escapeHtml(item.packageHuman || item.sizeHuman || "0 B")}<br><span class="muted">${formatNumber(item.packageFileCount || 1)} arquivo(s)</span></td>
              <td>${escapeHtml(labels[item.classification] || item.classification || "-")}</td>
              <td>${riskMarkup(item.risk)}</td>
              <td>${formatAccess(item.daysSinceAccess)}</td>
              <td>${formatAccess(item.daysSinceModified)}</td>
              <td>${escapeHtml(item.justification || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBlockedFiles(blockedFiles) {
  return `
    <section class="are-mode-section are-blocked-section">
      <div class="are-section-heading">
        <div>
          <h3>Arquivos bloqueados - ${formatNumber(blockedFiles.length)}</h3>
          <p class="muted">Arquivos fora dos niveis baixo, medio e alto por risco, sistema, ciclo, uso recente ou dependencia importante.</p>
        </div>
      </div>
      ${blockedFiles.length ? `
        <div class="table-wrap are-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tamanho</th>
                <th>Classe</th>
                <th>Risco</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              ${blockedFiles.slice(0, 120).map((item) => `
                <tr>
                  <td class="path-cell">${escapeHtml(item.path)}</td>
                  <td>${escapeHtml(item.sizeHuman || formatBytes(item.sizeBytes || 0))}</td>
                  <td>${escapeHtml(labels[item.classification] || item.classification || "-")}</td>
                  <td>${riskMarkup(item.risk)}</td>
                  <td>${escapeHtml(item.reason || item.blockingReasons?.[0] || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("Nenhum arquivo bloqueado.")}
    </section>
  `;
}

function openAreModal() {
  if (!state.result?.relocationPlan || !elements.areModal) {
    return;
  }
  elements.areModal.classList.remove("is-hidden");
  elements.areModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeAreModal() {
  if (!elements.areModal) {
    return;
  }
  elements.areModal.classList.add("is-hidden");
  elements.areModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function modeLabel(modeKey) {
  const labels = {
    baixo: "Nivel baixo",
    medio: "Nivel medio",
    alto: "Nivel alto"
  };
  return labels[modeKey] || modeKey;
}

function modeRiskClass(modeKey) {
  if (modeKey === "baixo") return "baixo";
  if (modeKey === "medio") return "medio";
  return "alto";
}

function renderContinuousState() {
  if (!state.result || !elements.continuousState) {
    return;
  }

  const alc = state.result.continuousState;
  if (!alc) {
    elements.continuousState.innerHTML = empty("Estado A.L.C indisponivel.");
    return;
  }

  const summary = alc.summary || {};
  elements.continuousState.innerHTML = metricMarkup([
    [alc.mode === "primeiro_estado" ? "inicial" : "comparacao", "modo"],
    [summary.newFiles || 0, "novos"],
    [summary.modifiedFiles || 0, "modificados"],
    [summary.removedFiles || 0, "removidos"],
    [summary.riskChangedFiles || 0, "mudanca risco"],
    [summary.dependencyChangedFiles || 0, "mudanca deps"],
    [summary.reanalysisNeeded ? "sim" : "nao", "reanalise"],
    [state.result.modules?.alc?.statePath ? "salvo" : "nao salvo", "estado"]
  ]);
}

function renderDepthTimeline() {
  if (!state.result || !elements.depthTimeline) {
    return;
  }

  const depths = state.result.summary?.depthBreakdown || [];
  const relocationDepths = new Map((state.result.relocationPlan?.depthRelocation || []).map((item) => [Number(item.depth), item]));
  if (!depths.length) {
    elements.depthTimeline.innerHTML = empty("Nenhuma profundidade registrada.");
    return;
  }

  elements.depthTimeline.innerHTML = depths.map((depth) => {
    const relocation = relocationDepths.get(Number(depth.depth)) || {};
    const high = relocation.reallocatableHuman?.alto || "0 B";
    const medium = relocation.reallocatableHuman?.medio || "0 B";
    const low = relocation.reallocatableHuman?.baixo || "0 B";
    return `
      <button class="depth-row" type="button" data-depth="${escapeHtml(depth.depth)}">
        <span class="depth-index">Prof. ${escapeHtml(depth.depth)}</span>
        <span>${formatNumber(depth.files)} arquivo(s)</span>
        <strong>${escapeHtml(depth.human || "0 B")}</strong>
        <small>ARE alto ${escapeHtml(high)} / medio ${escapeHtml(medium)} / baixo ${escapeHtml(low)}</small>
      </button>
    `;
  }).join("");

  elements.depthTimeline.querySelectorAll("[data-depth]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!elements.depthFilter) {
        return;
      }
      elements.depthFilter.value = String(button.dataset.depth);
      renderGraph();
      renderFiles();
    });
  });
}

function renderCycles() {
  if (!state.result || !elements.cyclesList) {
    return;
  }

  const cycles = state.result.cycles || [];
  if (!cycles.length) {
    elements.cyclesList.innerHTML = empty("Nenhum ciclo detectado por DFS.");
    return;
  }

  const nodesById = new Map(state.result.nodes.map((node) => [node.id, node]));
  elements.cyclesList.innerHTML = cycles.map((cycle) => {
    const files = cycle.nodeIds
      .map((id) => nodesById.get(id)?.relativePath)
      .filter(Boolean)
      .join(" -> ");
    return `
      <div class="warning-item critical-warning">
        <strong>${escapeHtml(cycle.id)} - ${formatNumber(cycle.nodeCount)} arquivos</strong>
        <p class="muted">${escapeHtml(files)}</p>
        <p class="muted">${escapeHtml(cycle.suggestion || "manter junto e revisar manualmente")}</p>
      </div>
    `;
  }).join("");
}

function renderTextReport() {
  if (!state.result || !elements.textReport) {
    return;
  }
  elements.textReport.textContent = state.result.report?.text || "";
}

function renderDependencies() {
  if (!state.result) {
    return;
  }

  const rows = state.result.edges.slice(0, 1200);
  if (!rows.length) {
    elements.dependenciesTable.innerHTML = empty("Nenhuma dependência local resolvida.");
    return;
  }

  elements.dependenciesTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Linha</th>
          <th>Origem</th>
          <th>Destino</th>
          <th>Declaração</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((edge) => `
          <tr>
            <td>${escapeHtml(edge.type)}</td>
            <td>${edge.line || "-"}</td>
            <td class="path-cell">${escapeHtml(edge.sourcePath)}</td>
            <td class="path-cell">${escapeHtml(edge.targetPath)}</td>
            <td class="path-cell">${escapeHtml(edge.specifier)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderWarnings() {
  if (!state.result) {
    return;
  }

  const items = [
    ...state.result.warnings.map((warning) => ({ path: "varredura", reason: warning })),
    ...state.result.skipped
  ];

  if (!items.length) {
    elements.warningsList.innerHTML = empty("Sem avisos para esta varredura.");
    return;
  }

  elements.warningsList.innerHTML = items.slice(0, 500).map((item) => `
    <div class="warning-item">
      <strong>${escapeHtml(item.path || ".")}</strong>
      <p class="muted">${escapeHtml(item.reason || "ignorado")}</p>
    </div>
  `).join("");
}

function exportJson() {
  if (!state.result) {
    return;
  }
  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `relatorio-add-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function riskMarkup(risk) {
  return `<span class="risk ${escapeHtml(risk)}">${escapeHtml(risk)}</span>`;
}

function decisionLabel(value) {
  const labels = {
    pode_apagar: "pode apagar",
    inutil_provavel: "inútil provável",
    averiguar: "averiguar",
    nao_apagar: "não apagar"
  };
  return labels[value] || value || "-";
}

function utilityLabel(value) {
  const labels = {
    sistema: "sistema",
    protegido: "protegido",
    usado_pelo_usuario: "usado",
    dependencia_relevante: "dependência relevante",
    bloco_interdependente: "bloco interdependente",
    inutil_provavel: "inútil provável",
    baixo_uso: "baixo uso",
    utilidade_incerta: "incerta",
    desconhecido: "desconhecida"
  };
  return labels[value] || value || "-";
}

function impactLabel(value) {
  const labels = {
    afeta_sistema: "afeta sistema",
    nao_afeta_sistema: "não afeta sistema",
    protegido: "protegido",
    critico: "critico",
    alto: "alto",
    medio: "médio",
    baixo: "baixo",
    nenhum: "nenhum",
    incerto: "incerto"
  };
  return labels[value] || value || "-";
}

function formatAccess(days) {
  if (!Number.isFinite(Number(days))) {
    return "-";
  }
  if (days <= 0) {
    return "hoje";
  }
  if (days === 1) {
    return "1 dia";
  }
  return `${formatNumber(days)} dias`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value ?? "-");
  }
  return new Intl.NumberFormat("pt-BR").format(numeric);
}

function formatCompact(value) {
  if (value >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(value);
}

function trimLabel(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(3, maxLength - 1))}…`;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hashNumber(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function empty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
