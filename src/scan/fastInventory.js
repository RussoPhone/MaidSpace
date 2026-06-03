const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { classifyFileKnowledge } = require("../add/fileKnowledge");

const PROTECTED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".gitignore",
  ".npmrc",
  ".yarnrc",
  "cargo.lock",
  "composer.lock",
  "dockerfile",
  "go.mod",
  "go.sum",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "webpack.config.js",
  "yarn.lock"
]);

const PROTECTED_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".dll",
  ".dylib",
  ".exe",
  ".msi",
  ".ps1",
  ".reg",
  ".sh",
  ".so",
  ".sys"
]);

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".less",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rs",
  ".scss",
  ".svelte",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".md"
]);

const SPECIAL_TEXT_FILES = new Set([
  "dockerfile",
  "makefile",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle"
]);

const DEFAULT_HEAVY_FOLDER_BYTES = 2 * 1024 * 1024 * 1024;

async function scanFastInventory(rootPath, options = {}, onProgress = null) {
  if (process.platform === "win32") {
    return scanWithRobocopy(rootPath, options, onProgress);
  }

  return {
    provider: "indisponivel",
    nodes: [],
    fileNodes: [],
    skipped: [],
    warnings: ["Inventario turbo nativo ainda esta disponivel apenas no Windows."],
    stopReason: "Inventario turbo indisponivel nesta plataforma.",
    stats: emptyStats("indisponivel")
  };
}

async function scanWithRobocopy(rootPath, options = {}, onProgress = null) {
  const root = path.resolve(rootPath);
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "src-robocopy-null-"));
  await fs.mkdir(destination, { recursive: true });

  const maxMs = clampNumber(options.fastScanMs, 1000, 10 * 60 * 1000, 30000);
  const maxStoredFiles = clampNumber(options.fastStoredFiles, 1000, 500000, 25000);
  const maxStoredDirectories = clampNumber(options.fastStoredDirectories, 500, 100000, 20000);
  const stats = emptyStats("robocopy");
  const nodes = [];
  const fileNodes = [];
  const skipped = [];
  const warnings = [];
  const overflow = [];
  const folderDatabase = new Map();
  const dependencyGroupDatabase = new Map();
  const startedAt = Date.now();
  let buffer = "";
  let lastProgressAt = 0;
  let lastPath = ".";
  let stopReason = null;
  let settled = false;

  const excludedDirectories = Array.from(new Set([
    destination,
    ...((options.skipDirectories || []).map((item) => String(item)).filter(Boolean))
  ]));
  const args = [
    root,
    destination,
    "/L",
    "/E",
    "/BYTES",
    "/FP",
    "/TS",
    "/XJ",
    "/R:0",
    "/W:0",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD",
    ...excludedDirectories
  ];

  const child = spawn("robocopy", args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const timer = setTimeout(() => {
    stopReason = `Inventario turbo interrompido por limite de ${maxMs} ms; resultado parcial gerado.`;
    killProcessTree(child);
  }, maxMs);

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      consumeRobocopyLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) {
      warnings.push(text.slice(0, 300));
    }
  });

  try {
    await new Promise((resolve) => {
      const hardTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        stopReason = stopReason || `Inventario turbo forcado a encerrar apos ${maxMs + 5000} ms; resultado parcial gerado.`;
        killProcessTree(child);
        resolve();
      }, maxMs + 5000);

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(hardTimer);
        if (buffer.trim()) {
          consumeRobocopyLine(buffer);
          buffer = "";
        }
        if (code >= 8 && !stopReason) {
          stopReason = `Robocopy retornou codigo ${code}; inventario parcial mantido.`;
        }
        resolve();
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(hardTimer);
        stopReason = `Falha ao iniciar inventario turbo: ${error.message}`;
        resolve();
      });
    });
  } finally {
    clearTimeout(timer);
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
  }

  pruneStoredFiles(true);
  const auxiliaryInventory = buildAuxiliaryInventory(folderDatabase, dependencyGroupDatabase, options);
  applyInventoryScanStrategy(fileNodes, auxiliaryInventory.heavyFolders, options);
  stats.elapsedMs = Date.now() - startedAt;
  stats.storedFiles = fileNodes.length;
  stats.storedDirectories = nodes.filter((node) => node.kind === "directory").length;
  stats.truncated = stats.files > stats.storedFiles;
  stats.heavyFolders = auxiliaryInventory.heavyFolders;
  stats.dependencyGroups = auxiliaryInventory.dependencyGroups;
  stats.auxiliaryDatabase = auxiliaryInventory.auxiliaryDatabase;
  if (stopReason) {
    warnings.push(stopReason);
  }

  return {
    provider: "robocopy",
    nodes,
    fileNodes,
    skipped,
    warnings,
    stopReason,
    stats
  };

  function consumeRobocopyLine(rawLine) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    const file = parseRobocopyFileLine(line);
    if (file) {
      const absolutePath = path.resolve(file.absolutePath);
      const relativePath = normalizeRelative(path.relative(root, absolutePath));
      if (!relativePath || relativePath.startsWith("..")) {
        return;
      }
      const node = createInventoryNode({
        root,
        absolutePath,
        relativePath,
        size: file.size,
        modifiedAt: file.modifiedAt,
        options
      });
      stats.files += 1;
      stats.totalBytes += node.size || 0;
      lastPath = relativePath;
      rememberAuxiliaryFile(node);
      rememberFileNode(node);
      emitProgress();
      return;
    }

    const directory = parseRobocopyDirectoryLine(line);
    if (directory) {
      const absolutePath = path.resolve(directory.absolutePath);
      const relativePath = normalizeRelative(path.relative(root, absolutePath));
      if (!relativePath || relativePath.startsWith("..")) {
        return;
      }
      stats.directories += 1;
      lastPath = relativePath;
      rememberAuxiliaryDirectory(relativePath);
      if (nodes.length < maxStoredDirectories) {
        nodes.push({
          id: `dir:${relativePath}`,
          kind: "directory",
          name: path.basename(relativePath),
          relativePath,
          scanDepth: filesystemDepth(relativePath) + 1,
          size: 0,
          extension: "",
          protectedReasons: protectedReasonsFor(absolutePath, relativePath, path.basename(relativePath), "", options),
          classification: "diretorio",
          risk: "baixo"
        });
      }
      emitProgress();
    }
  }

  function rememberAuxiliaryDirectory(relativePath) {
    if (!folderDatabase.has(relativePath)) {
      folderDatabase.set(relativePath, createFolderRecord(relativePath));
    }
  }

  function rememberAuxiliaryFile(node) {
    for (const folderPath of folderCandidatesFor(node.relativePath)) {
      if (!folderDatabase.has(folderPath)) {
        folderDatabase.set(folderPath, createFolderRecord(folderPath));
      }
      const folder = folderDatabase.get(folderPath);
      folder.files += 1;
      folder.bytes += node.size || 0;
      folder.riskScore += fileRiskWeight(node);
      for (const category of node.fileKnowledge?.categories || []) {
        folder.categories[category] = (folder.categories[category] || 0) + 1;
      }
      const dependencyGroup = node.dependencyGroup || node.fileKnowledge?.dependencyGroup || "dpn:incerto";
      folder.dependencyGroups[dependencyGroup] = (folder.dependencyGroups[dependencyGroup] || 0) + 1;
      if (folder.samples.length < 8) {
        folder.samples.push(node.relativePath);
      }
    }

    const dependencyGroup = node.dependencyGroup || node.fileKnowledge?.dependencyGroup || "dpn:incerto";
    if (!dependencyGroupDatabase.has(dependencyGroup)) {
      dependencyGroupDatabase.set(dependencyGroup, {
        key: dependencyGroup,
        files: 0,
        bytes: 0,
        riskCategory: node.fileKnowledge?.riskCategory || "incerto",
        typeCategory: node.fileKnowledge?.typeCategory || "desconhecido",
        lastUseBucket: node.fileKnowledge?.lastUseBucket || "idade_desconhecida",
        createdBucket: node.fileKnowledge?.createdBucket || "idade_desconhecida",
        samples: []
      });
    }
    const group = dependencyGroupDatabase.get(dependencyGroup);
    group.files += 1;
    group.bytes += node.size || 0;
    if (group.samples.length < 8) {
      group.samples.push(node.relativePath);
    }
  }

  function rememberFileNode(node) {
    if (fileNodes.length < maxStoredFiles) {
      fileNodes.push(node);
      nodes.push(node);
      return;
    }
    overflow.push(node);
    if (overflow.length >= 2500) {
      pruneStoredFiles(false);
    }
  }

  function pruneStoredFiles(finalPass) {
    if (!overflow.length && !finalPass) {
      return;
    }
    if (overflow.length) {
      fileNodes.push(...overflow.splice(0));
    }
    const selectedFiles = selectBalancedInventoryNodes(fileNodes, maxStoredFiles);
    fileNodes.length = 0;
    fileNodes.push(...selectedFiles);
    const directories = nodes.filter((node) => node.kind === "directory");
    nodes.length = 0;
    nodes.push(...directories.slice(0, maxStoredDirectories), ...fileNodes);
  }

  function emitProgress() {
    const now = Date.now();
    if (now - lastProgressAt < 1000) {
      return;
    }
    lastProgressAt = now;
    onProgress?.({
      provider: "robocopy",
      phase: "inventario_turbo",
      currentPath: lastPath,
      files: stats.files,
      directories: stats.directories,
      totalBytes: stats.totalBytes,
      totalHuman: formatBytes(stats.totalBytes),
      elapsedMs: now - startedAt,
      storedFiles: fileNodes.length,
      dependencyGroups: dependencyGroupDatabase.size,
      heavyFolderCandidates: Array.from(folderDatabase.values()).filter((folder) => isHeavyFolder(folder, options)).length
    });
  }
}

function parseRobocopyFileLine(line) {
  const match = line.match(/^\s*(?:.+?\s+)?(\d+)\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+?)\s*$/);
  if (!match) {
    return null;
  }
  const absolutePath = match[3];
  if (!/^[a-zA-Z]:[\\/]/.test(absolutePath) && !absolutePath.startsWith("\\\\")) {
    return null;
  }
  return {
    size: Number(match[1]) || 0,
    modifiedAt: parseRobocopyTimestamp(match[2]),
    absolutePath
  };
}

function killProcessTree(child) {
  if (!child || !child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("error", () => {
      child.kill();
    });
    return;
  }

  child.kill("SIGKILL");
}

function parseRobocopyDirectoryLine(line) {
  const match = line.match(/^\s*\d+\s+([a-zA-Z]:[\\/].*?[\\/]?)\s*$/);
  if (!match) {
    return null;
  }
  return { absolutePath: match[1] };
}

function parseRobocopyTimestamp(value) {
  const isoLike = String(value || "").replace(/\//g, "-").replace(" ", "T");
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function createInventoryNode({ absolutePath, relativePath, size, modifiedAt, options }) {
  const name = path.basename(relativePath);
  const extension = path.extname(name).toLowerCase();
  const fileKnowledge = classifyFileKnowledge(relativePath, name, extension, {
    size,
    modifiedAt,
    lastAccessedAt: modifiedAt,
    createdAt: modifiedAt
  });
  const protectedReasons = protectedReasonsFor(absolutePath, relativePath, name, extension, options);
  const lastAccessedAt = modifiedAt;

  return {
    id: `file:${relativePath}`,
    kind: "file",
    name,
    relativePath,
    absolutePath,
    extension,
    size,
    modifiedAt: modifiedAt.toISOString(),
    lastAccessedAt: lastAccessedAt.toISOString(),
    createdAt: modifiedAt.toISOString(),
    daysSinceAccess: daysBetween(lastAccessedAt, new Date()),
    protectedReasons,
    fileKnowledge,
    dependencyGroup: fileKnowledge.dependencyGroup,
    scanStrategy: {
      discovery: "balanced_search_ntfs",
      inventoryProvider: "robocopy",
      dependencyGroup: fileKnowledge.dependencyGroup,
      heavyFolderPath: null
    },
    dependencyProbe: {
      enabled: false,
      reason: null,
      status: "not_needed"
    },
    incoming: 0,
    outgoing: 0,
    incomingFrom: [],
    outgoingTo: [],
    depth: 0,
    scanDepth: filesystemDepth(relativePath),
    impactCount: 0,
    componentId: null,
    componentSize: 1,
    dfsColor: "branco",
    inCycle: false,
    cycleBlockId: null,
    cycleBlockIds: [],
    cycleGroupSize: 0,
    dependsOn: [],
    dependents: [],
    classification: "isolado",
    risk: "baixo",
    riskScore: 0,
    riskReasons: [],
    impact: {
      system: "desconhecido",
      user: "desconhecido",
      dependencies: "desconhecido"
    },
    utilityStatus: "desconhecido",
    deletionDecision: "averiguar",
    relocationDecision: "pode_mexer",
    simulationAction: "separar_como_isolado",
    simulation: null,
    canReadContent: false,
    readError: null,
    detectedDependencies: [],
    initialUnresolvedDependencies: 0,
    initialUnresolvedSpecifiers: [],
    unresolvedDependencies: 0,
    unresolvedSpecifiers: [],
    externalDependencies: 0
  };
}

function protectedReasonsFor(absolutePath, relativePath, name, extension, options = {}) {
  const reasons = [];
  const lowerAbsolute = String(absolutePath || "").toLowerCase();
  const lowerRelative = normalizeRelative(relativePath).toLowerCase();
  const lowerName = String(name || "").toLowerCase();
  const lowerExtension = String(extension || path.extname(lowerName)).toLowerCase();
  const knowledge = classifyFileKnowledge(relativePath, name, lowerExtension);

  if (PROTECTED_FILE_NAMES.has(lowerName)) {
    reasons.push("arquivo de configuracao/lock");
  }
  if (PROTECTED_EXTENSIONS.has(lowerExtension)) {
    reasons.push("executavel ou biblioteca do sistema");
  }
  if (knowledge.isSystemEssential) {
    reasons.push("tipo essencial do sistema");
  }
  if (knowledge.isProjectDependency) {
    reasons.push("dependencia/configuracao de projeto");
  }
  if (/(^|[\\/])(windows|system32|winsxs|windowsapps|programdata|recovery|system volume information|\$recycle\.bin)([\\/]|$)/i.test(lowerAbsolute)) {
    reasons.push("diretorio do sistema operacional");
  }
  if (/(^|\/)(windows|system32|winsxs|windowsapps|programdata|recovery|system volume information|\$recycle\.bin)(\/|$)/i.test(lowerRelative)) {
    reasons.push("diretorio do sistema operacional");
  }
  if (!options.includeProgramFiles && /(^|[\\/])program files( \(x86\))?([\\/]|$)/i.test(lowerAbsolute)) {
    reasons.push("diretorio do sistema operacional");
  }

  return Array.from(new Set(reasons));
}

function inventoryNodeScore(node) {
  const relativePath = String(node.relativePath || "").toLowerCase();
  const extension = String(node.extension || "").toLowerCase();
  let score = node.size || 0;
  if (/(^|\/)(downloads|desktop|videos|pictures|music|backup|backups|archive|archives)(\/|$)/.test(relativePath)) {
    score += 2 * 1024 * 1024 * 1024;
  }
  if (/(^|\/)(cache|tmp|temp|logs?|\.cache|dist|build|out|target|coverage)(\/|$)/.test(relativePath)) {
    score += 1024 * 1024 * 1024;
  }
  if ([".zip", ".7z", ".rar", ".iso", ".mp4", ".mov", ".mkv", ".bak", ".old", ".tmp", ".log"].includes(extension)) {
    score += 512 * 1024 * 1024;
  }
  if (node.fileKnowledge?.isProjectDependency || node.fileKnowledge?.isSourceCode) {
    score += 256 * 1024 * 1024;
  }
  if (node.fileKnowledge?.isSystemEssential) {
    score += 128 * 1024 * 1024;
  }
  if (node.protectedReasons?.length) {
    score -= 4 * 1024 * 1024 * 1024;
  }
  return score;
}

function selectBalancedInventoryNodes(candidates, limit) {
  if (candidates.length <= limit) {
    return candidates
      .slice()
      .sort((a, b) => inventoryNodeScore(b) - inventoryNodeScore(a) || a.relativePath.localeCompare(b.relativePath));
  }

  const groups = new Map();
  for (const node of candidates) {
    const key = node.dependencyGroup || node.fileKnowledge?.dependencyGroup || "dpn:incerto";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(node);
  }

  const orderedGroups = Array.from(groups.values())
    .map((items) => items.sort((a, b) => inventoryNodeScore(b) - inventoryNodeScore(a) || a.relativePath.localeCompare(b.relativePath)))
    .sort((a, b) => inventoryNodeScore(b[0]) - inventoryNodeScore(a[0]) || a[0].relativePath.localeCompare(b[0].relativePath));
  const selected = [];
  const selectedIds = new Set();

  while (selected.length < limit) {
    let added = false;
    for (const group of orderedGroups) {
      const node = group.shift();
      if (!node || selectedIds.has(node.id)) {
        continue;
      }
      selected.push(node);
      selectedIds.add(node.id);
      added = true;
      if (selected.length >= limit) {
        break;
      }
    }
    if (!added) {
      break;
    }
  }

  return selected.sort((a, b) => inventoryNodeScore(b) - inventoryNodeScore(a) || a.relativePath.localeCompare(b.relativePath));
}

function buildAuxiliaryInventory(folderDatabase, dependencyGroupDatabase, options = {}) {
  const heavyFolders = Array.from(folderDatabase.values())
    .filter((folder) => isHeavyFolder(folder, options))
    .sort((a, b) => heavyFolderScore(b) - heavyFolderScore(a) || a.path.localeCompare(b.path))
    .slice(0, 100)
    .map((folder) => ({
      ...folder,
      bytesHuman: formatBytes(folder.bytes),
      reason: heavyFolderReason(folder, options),
      topDependencyGroups: topEntries(folder.dependencyGroups, 6),
      topCategories: topEntries(folder.categories, 6)
    }));

  const dependencyGroups = Array.from(dependencyGroupDatabase.values())
    .sort((a, b) => b.files - a.files || b.bytes - a.bytes || a.key.localeCompare(b.key))
    .slice(0, 200)
    .map((group) => ({
      ...group,
      bytesHuman: formatBytes(group.bytes)
    }));

  return {
    heavyFolders,
    dependencyGroups,
    auxiliaryDatabase: {
      provider: "robocopy",
      model: "ntfs_metadata_auxiliary",
      filesIndexed: Array.from(dependencyGroupDatabase.values()).reduce((sum, group) => sum + group.files, 0),
      foldersIndexed: folderDatabase.size,
      groupsIndexed: dependencyGroupDatabase.size,
      heavyFoldersIndexed: heavyFolders.length
    }
  };
}

function applyInventoryScanStrategy(fileNodes, heavyFolders, options = {}) {
  const orderedFolders = (heavyFolders || [])
    .slice()
    .sort((a, b) => String(b.path || ".").length - String(a.path || ".").length);

  for (const node of fileNodes) {
    const folder = orderedFolders.find((candidate) => pathContainsFile(candidate.path || ".", node.relativePath));
    node.heavyFolder = folder ? {
      path: folder.path,
      files: folder.files,
      bytes: folder.bytes,
      bytesHuman: folder.bytesHuman || formatBytes(folder.bytes),
      riskScore: folder.riskScore,
      reason: folder.reason || heavyFolderReason(folder, options)
    } : null;
    node.scanStrategy = {
      ...(node.scanStrategy || {}),
      discovery: "balanced_search_ntfs",
      inventoryProvider: "robocopy",
      dependencyGroup: node.dependencyGroup || node.fileKnowledge?.dependencyGroup || "dpn:incerto",
      heavyFolderPath: node.heavyFolder?.path || null
    };
    node.dependencyProbe = dependencyProbeFor(node, options);
  }
}

function dependencyProbeFor(node, options = {}) {
  if (options.targetedDfsProbe === false || !node.heavyFolder) {
    return { enabled: false, reason: node.heavyFolder ? "disabled" : "fora_de_hf", status: "not_needed" };
  }

  const lowerName = String(node.name || "").toLowerCase();
  const textCandidate = isTextCandidate(lowerName, node.extension);
  const knowledge = node.fileKnowledge || {};
  const riskyDependency =
    node.protectedReasons?.length > 0
    || knowledge.isSystemEssential
    || knowledge.isProjectDependency
    || knowledge.isSourceCode
    || knowledge.riskCategory === "dependencia"
    || knowledge.riskCategory === "sistema";
  const riskyHeavyFolder = (node.heavyFolder.riskScore || 0) >= heavyFolderRiskThreshold(options);

  if (!textCandidate) {
    return {
      enabled: false,
      reason: riskyDependency || riskyHeavyFolder ? "hf_risco_nao_texto" : "nao_texto",
      status: "skipped_non_text"
    };
  }
  if (!riskyDependency && !riskyHeavyFolder) {
    return { enabled: false, reason: "hf_sem_dpn_de_risco", status: "not_needed" };
  }

  return {
    enabled: true,
    reason: riskyDependency ? "dpn_de_risco_em_hf" : "hf_risco_agregado",
    status: "queued",
    maxBytes: options.maxDependencyReadBytes || 512 * 1024,
    maxMs: options.maxDependencyReadMs || 80
  };
}

function createFolderRecord(folderPath) {
  return {
    path: folderPath || ".",
    files: 0,
    bytes: 0,
    riskScore: 0,
    categories: {},
    dependencyGroups: {},
    samples: []
  };
}

function folderCandidatesFor(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const directory = normalizeRelative(path.posix.dirname(normalized));
  const top = topDirectory(normalized);
  return Array.from(new Set([
    directory && directory !== "." ? directory : ".",
    top || ".",
    "."
  ]));
}

function pathContainsFile(folderPath, relativePath) {
  const folder = normalizeRelative(folderPath || ".");
  const file = normalizeRelative(relativePath || ".");
  return folder === "." || file === folder || file.startsWith(`${folder}/`);
}

function isHeavyFolder(folder, options = {}) {
  return (folder.files || 0) >= heavyFolderFileThreshold(options)
    || (folder.bytes || 0) >= heavyFolderBytesThreshold(options)
    || (folder.riskScore || 0) >= heavyFolderRiskThreshold(options);
}

function heavyFolderScore(folder) {
  return ((folder.files || 0) * 1000) + Math.min(folder.bytes || 0, 1024 * 1024 * 1024 * 1024) + ((folder.riskScore || 0) * 100000);
}

function heavyFolderReason(folder, options = {}) {
  const reasons = [];
  if ((folder.files || 0) >= heavyFolderFileThreshold(options)) {
    reasons.push("muitos_arquivos");
  }
  if ((folder.bytes || 0) >= heavyFolderBytesThreshold(options)) {
    reasons.push("muitos_bytes");
  }
  if ((folder.riskScore || 0) >= heavyFolderRiskThreshold(options)) {
    reasons.push("dpn_de_risco");
  }
  return reasons.join("+") || "amostragem_hf";
}

function fileRiskWeight(node) {
  const knowledge = node.fileKnowledge || {};
  let score = 0;
  if (node.protectedReasons?.length) {
    score += 8;
  }
  if (knowledge.isSystemEssential) {
    score += 10;
  }
  if (knowledge.isProjectDependency || knowledge.isSourceCode) {
    score += 6;
  }
  if (knowledge.isArchive || knowledge.riskCategory === "arquivo_pesado") {
    score += 4;
  }
  if (knowledge.isLowValueGenerated) {
    score += 2;
  }
  if ((node.size || 0) >= 1024 * 1024 * 1024) {
    score += 4;
  }
  return score;
}

function topEntries(record, limit) {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function topDirectory(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized === "." || !normalized.includes("/")) {
    return ".";
  }
  return normalized.split("/")[0];
}

function isTextCandidate(lowerName, extension) {
  return TEXT_EXTENSIONS.has(extension) || SPECIAL_TEXT_FILES.has(lowerName);
}

function heavyFolderFileThreshold(options) {
  return clampNumber(options.heavyFolderFileThreshold, 1, 1000000, 2500);
}

function heavyFolderBytesThreshold(options) {
  return clampNumber(options.heavyFolderBytesThreshold, 0, 1024 * 1024 * 1024 * 1024, DEFAULT_HEAVY_FOLDER_BYTES);
}

function heavyFolderRiskThreshold(options) {
  return clampNumber(options.heavyFolderRiskThreshold, 0, 100000, 8);
}

function emptyStats(provider) {
  return {
    provider,
    files: 0,
    directories: 0,
    totalBytes: 0,
    totalHuman: "0 B",
    storedFiles: 0,
    storedDirectories: 0,
    truncated: false,
    elapsedMs: 0,
    dependencyGroups: [],
    heavyFolders: [],
    auxiliaryDatabase: null
  };
}

function normalizeRelative(value) {
  const normalized = String(value || ".").replace(/\\/g, "/");
  return path.posix.normalize(normalized).replace(/^\.$/, ".");
}

function filesystemDepth(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized === ".") {
    return 0;
  }
  return normalized.split("/").filter(Boolean).length - 1;
}

function daysBetween(date, now) {
  const diff = now.getTime() - date.getTime();
  if (!Number.isFinite(diff) || diff < 0) {
    return 0;
  }
  return Math.floor(diff / 86400000);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

module.exports = {
  scanFastInventory
};
