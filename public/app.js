const state = {
  result: null,
  activeTab: "graph",
  graphLayout: new Map(),
  selectedNodeId: null
};

const labels = {
  isolado: "isolado",
  dependente: "dependente",
  provedor: "provedor",
  dependente_provedor: "dependente/provedor",
  critico_protegido: "crítico/protegido",
  diretorio: "diretório"
};

const classColors = {
  isolado: "#3f8b5d",
  dependente: "#26788d",
  provedor: "#c0792b",
  dependente_provedor: "#75569f",
  critico_protegido: "#9d3434",
  diretorio: "#7a7f83"
};

const riskWeight = {
  alto: 3,
  medio: 2,
  baixo: 1
};

const elements = {
  serverStatus: document.querySelector("#serverStatus"),
  rootPath: document.querySelector("#rootPath"),
  maxFiles: document.querySelector("#maxFiles"),
  maxDepth: document.querySelector("#maxDepth"),
  maxFileSize: document.querySelector("#maxFileSize"),
  scanButton: document.querySelector("#scanButton"),
  exportButton: document.querySelector("#exportButton"),
  metrics: document.querySelector("#metrics"),
  graphCanvas: document.querySelector("#graphCanvas"),
  graphHint: document.querySelector("#graphHint"),
  graphFilter: document.querySelector("#graphFilter"),
  nodeDetails: document.querySelector("#nodeDetails"),
  fileSearch: document.querySelector("#fileSearch"),
  filesTable: document.querySelector("#filesTable"),
  simulationGrid: document.querySelector("#simulationGrid"),
  dependenciesTable: document.querySelector("#dependenciesTable"),
  warningsList: document.querySelector("#warningsList")
};

init();

async function init() {
  bindEvents();
  renderEmpty();

  try {
    const health = await fetchJson("/api/health");
    elements.rootPath.value = health.cwd;
    elements.maxFiles.value = health.defaultOptions.maxFiles;
    elements.maxDepth.value = health.defaultOptions.maxDepth;
    elements.maxFileSize.value = health.defaultOptions.maxFileSizeBytes;
    setStatus("pronto", "ok");
  } catch (error) {
    setStatus("servidor indisponível", "error");
  }
}

function bindEvents() {
  elements.scanButton.addEventListener("click", runScan);
  elements.exportButton.addEventListener("click", exportJson);
  elements.graphFilter.addEventListener("change", renderGraph);
  elements.fileSearch.addEventListener("input", renderFiles);
  elements.graphCanvas.addEventListener("click", selectCanvasNode);

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

async function runScan() {
  const rootPath = elements.rootPath.value.trim();
  if (!rootPath) {
    setStatus("informe um diretório", "error");
    elements.rootPath.focus();
    return;
  }

  const payload = {
    rootPath,
    options: {
      maxFiles: Number(elements.maxFiles.value),
      maxDepth: Number(elements.maxDepth.value),
      maxFileSizeBytes: Number(elements.maxFileSize.value)
    }
  };

  elements.scanButton.disabled = true;
  elements.exportButton.disabled = true;
  setStatus("escaneando", "busy");

  try {
    state.result = await fetchJson("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.selectedNodeId = null;
    elements.exportButton.disabled = false;
    setStatus(`ok · ${state.result.summary.elapsedMs} ms`, "ok");
    renderAll();
  } catch (error) {
    setStatus("erro na varredura", "error");
    renderError(error.message);
  } finally {
    elements.scanButton.disabled = false;
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

function renderAll() {
  renderMetrics();
  renderGraph();
  renderFiles();
  renderSimulation();
  renderDependencies();
  renderWarnings();
  renderNodeDetails();
}

function renderEmpty() {
  elements.metrics.innerHTML = metricMarkup([
    ["0", "arquivos"],
    ["0", "diretórios"],
    ["0", "arestas"],
    ["0", "componentes"],
    ["0", "alto risco"],
    ["0", "médio risco"],
    ["0", "baixo risco"],
    ["0", "isolados"]
  ]);
  elements.filesTable.innerHTML = empty("Nenhuma varredura executada.");
  elements.dependenciesTable.innerHTML = empty("Nenhuma dependência detectada ainda.");
  elements.simulationGrid.innerHTML = "";
  elements.warningsList.innerHTML = empty("Sem avisos.");
}

function renderError(message) {
  elements.metrics.innerHTML = "";
  elements.filesTable.innerHTML = empty(message);
  elements.dependenciesTable.innerHTML = empty(message);
  elements.simulationGrid.innerHTML = "";
  elements.warningsList.innerHTML = empty(message);
  clearCanvas(message);
}

function renderMetrics() {
  if (!state.result) {
    return;
  }
  const summary = state.result.summary;
  elements.metrics.innerHTML = metricMarkup([
    [summary.files, "arquivos"],
    [summary.directories, "diretórios"],
    [summary.edges, "arestas"],
    [summary.components, "componentes"],
    [summary.byRisk.alto || 0, "alto risco"],
    [summary.byRisk.medio || 0, "médio risco"],
    [summary.byRisk.baixo || 0, "baixo risco"],
    [summary.candidateLowRisk, "isolados candidatos"]
  ]);
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
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const visibleNodes = selectGraphNodes();
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const edges = state.result.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  elements.graphHint.textContent = `${visibleNodes.length} nós renderizados de ${state.result.summary.files}; ${edges.length} arestas visíveis.`;

  if (!visibleNodes.length) {
    clearCanvas("Nenhum nó dentro do filtro atual.");
    return;
  }

  const layout = computeColumnLayout(visibleNodes, width, height);
  state.graphLayout = layout;

  context.lineWidth = 1;
  for (const edge of edges) {
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) {
      continue;
    }
    context.beginPath();
    context.strokeStyle = "rgba(49, 55, 58, 0.18)";
    context.moveTo(source.x, source.y);
    const midX = (source.x + target.x) / 2;
    context.bezierCurveTo(midX, source.y, midX, target.y, target.x, target.y);
    context.stroke();
  }

  drawColumnLabels(context, width);

  for (const point of layout.values()) {
    const node = point.node;
    const degree = (node.incoming || 0) + (node.outgoing || 0);
    const radius = Math.min(13, 5 + Math.sqrt(degree + 1) * 2);
    context.beginPath();
    context.fillStyle = classColors[node.classification] || "#767c80";
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = node.id === state.selectedNodeId ? 3 : 1.5;
    context.strokeStyle = node.id === state.selectedNodeId ? "#111" : "#fff";
    context.stroke();
  }
}

function selectGraphNodes() {
  const filter = elements.graphFilter.value;
  const nodes = state.result.nodes
    .filter((node) => node.kind === "file")
    .filter((node) => filter === "all" || node.risk === filter);

  return nodes
    .sort((a, b) => {
      const scoreA = riskWeight[a.risk] * 100 + (a.incoming + a.outgoing) * 5 + a.depth;
      const scoreB = riskWeight[b.risk] * 100 + (b.incoming + b.outgoing) * 5 + b.depth;
      return scoreB - scoreA || a.relativePath.localeCompare(b.relativePath);
    })
    .slice(0, 260);
}

function computeColumnLayout(nodes, width, height) {
  const groups = [
    "critico_protegido",
    "provedor",
    "dependente_provedor",
    "dependente",
    "isolado"
  ];
  const grouped = new Map(groups.map((group) => [group, []]));
  for (const node of nodes) {
    if (!grouped.has(node.classification)) {
      grouped.set(node.classification, []);
    }
    grouped.get(node.classification).push(node);
  }

  const layout = new Map();
  const marginX = Math.max(30, width * 0.04);
  const top = 58;
  const bottom = 28;
  const columnGap = groups.length > 1 ? (width - marginX * 2) / (groups.length - 1) : 0;

  groups.forEach((group, columnIndex) => {
    const columnNodes = grouped.get(group) || [];
    const x = marginX + columnGap * columnIndex;
    const availableHeight = Math.max(120, height - top - bottom);
    columnNodes.forEach((node, rowIndex) => {
      const y = top + ((rowIndex + 1) * availableHeight) / (columnNodes.length + 1);
      layout.set(node.id, { x, y, node });
    });
  });

  return layout;
}

function drawColumnLabels(context, width) {
  const groups = [
    ["critico_protegido", "crítico"],
    ["provedor", "provedor"],
    ["dependente_provedor", "misto"],
    ["dependente", "dependente"],
    ["isolado", "isolado"]
  ];
  const marginX = Math.max(30, width * 0.04);
  const columnGap = groups.length > 1 ? (width - marginX * 2) / (groups.length - 1) : 0;
  context.font = "700 12px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#60676c";
  groups.forEach(([key, label], index) => {
    context.fillStyle = classColors[key] || "#60676c";
    context.fillText(label, marginX + columnGap * index, 24);
  });
}

function clearCanvas(message) {
  const canvas = elements.graphCanvas;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, rect.width || canvas.width, rect.height || canvas.height);
  context.fillStyle = "#626a70";
  context.font = "14px Segoe UI, sans-serif";
  context.fillText(message, 18, 32);
  elements.graphHint.textContent = message;
  state.graphLayout = new Map();
}

function selectCanvasNode(event) {
  if (!state.graphLayout.size) {
    return;
  }
  const rect = elements.graphCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of state.graphLayout.values()) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point.node;
    }
  }

  if (nearest && nearestDistance <= 24) {
    state.selectedNodeId = nearest.id;
    renderNodeDetails();
    renderGraph();
  }
}

function renderNodeDetails() {
  const node = state.result?.nodes.find((item) => item.id === state.selectedNodeId);
  if (!node) {
    elements.nodeDetails.innerHTML = `
      <h2>Nó selecionado</h2>
      <p class="muted">Clique em um nó do grafo ou em uma linha da tabela.</p>
    `;
    return;
  }

  const reasons = node.protectedReasons?.length ? node.protectedReasons.join(", ") : "sem proteção especial";
  const unresolved = node.unresolvedSpecifiers?.length
    ? node.unresolvedSpecifiers.map((item) => `${item.type}: ${item.specifier}`).join("; ")
    : "nenhuma";

  elements.nodeDetails.innerHTML = `
    <h2>${escapeHtml(node.name)}</h2>
    <dl>
      <dt>caminho</dt><dd>${escapeHtml(node.relativePath)}</dd>
      <dt>classe</dt><dd>${escapeHtml(labels[node.classification] || node.classification)}</dd>
      <dt>risco</dt><dd>${riskMarkup(node.risk)}</dd>
      <dt>entrada</dt><dd>${formatNumber(node.incoming || 0)}</dd>
      <dt>saída</dt><dd>${formatNumber(node.outgoing || 0)}</dd>
      <dt>profundidade</dt><dd>${formatNumber(node.depth || 0)}</dd>
      <dt>tamanho</dt><dd>${formatBytes(node.size || 0)}</dd>
      <dt>ação</dt><dd>${escapeHtml(node.simulationAction || "-")}</dd>
      <dt>proteção</dt><dd>${escapeHtml(reasons)}</dd>
      <dt>pendências</dt><dd>${escapeHtml(unresolved)}</dd>
    </dl>
  `;
}

function renderFiles() {
  if (!state.result) {
    return;
  }

  const query = elements.fileSearch.value.trim().toLowerCase();
  const rows = state.result.nodes
    .filter((node) => node.kind === "file")
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
          <th>Classe</th>
          <th>Entrada</th>
          <th>Saída</th>
          <th>Prof.</th>
          <th>Tamanho</th>
          <th>Caminho</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((node) => `
          <tr data-node-id="${escapeHtml(node.id)}">
            <td>${riskMarkup(node.risk)}</td>
            <td>${escapeHtml(labels[node.classification] || node.classification)}</td>
            <td>${formatNumber(node.incoming || 0)}</td>
            <td>${formatNumber(node.outgoing || 0)}</td>
            <td>${formatNumber(node.depth || 0)}</td>
            <td>${formatBytes(node.size || 0)}</td>
            <td class="path-cell">${escapeHtml(node.relativePath)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  elements.filesTable.querySelectorAll("tr[data-node-id]").forEach((row) => {
    row.addEventListener("click", () => {
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

  const buckets = [
    ["isolados", "Isolados", "baixo risco para separação"],
    ["dependentes", "Dependentes", "mover junto dos fornecedores"],
    ["provedores", "Provedores", "mantêm outros arquivos vivos"],
    ["mistos", "Dependente/provedor", "exigem revisão de cadeia"],
    ["protegidos", "Críticos/protegidos", "não mover automaticamente"],
    ["revisar", "Revisar", "casos sem classe clara"]
  ];

  elements.simulationGrid.innerHTML = buckets.map(([key, title, subtitle]) => {
    const items = state.result.simulation.buckets[key] || [];
    return `
      <article class="bucket">
        <h3>${escapeHtml(title)} · ${formatNumber(items.length)}</h3>
        <p class="muted">${escapeHtml(subtitle)}</p>
        ${items.length ? `
          <ol>
            ${items.slice(0, 18).map((item) => `<li>${escapeHtml(item.path)}</li>`).join("")}
          </ol>
        ` : `<p class="muted">Nenhum item.</p>`}
      </article>
    `;
  }).join("");
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
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
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
