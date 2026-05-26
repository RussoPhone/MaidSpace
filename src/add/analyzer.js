const fs = require("node:fs/promises");
const path = require("node:path");
const { classifyFileKnowledge, loadFileKnowledge } = require("./fileKnowledge");

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

const DEFAULT_OPTIONS = {
  adaptive: true,
  maxFiles: 5000,
  maxDepth: 18,
  maxFileSizeBytes: 512 * 1024,
  unusedDaysThreshold: loadFileKnowledge().recentUse?.unusedWindowDays || 30,
  frequentUseDaysThreshold: loadFileKnowledge().recentUse?.frequentWindowDays || 7,
  includeHidden: true,
  skipDirectories: [
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    ".idea",
    ".vscode",
    "__pycache__",
    "bin",
    "build",
    "coverage",
    "dist",
    "env",
    "node_modules",
    "obj",
    "out",
    "target",
    "venv",
    "$Recycle.Bin",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "Recovery",
    "System32",
    "System Volume Information",
    "Windows",
    "WindowsApps",
    "WinSxS"
  ]
};

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

const JS_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".vue", ".svelte"];
const STYLE_EXTENSIONS = [".css", ".scss", ".sass", ".less"];
const HTML_EXTENSIONS = [".html", ".htm", ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"];
const PY_EXTENSIONS = [".py", "/__init__.py"];
const C_EXTENSIONS = [".h", ".hpp", ".c", ".cc", ".cpp"];
const RUST_EXTENSIONS = [".rs", "/mod.rs"];

async function analyzeDirectory(rootPath, rawOptions = {}) {
  const root = path.resolve(rootPath || process.cwd());
  const startedAt = Date.now();
  const warnings = [];
  const skipped = [];
  const nodes = [];
  const fileNodes = [];
  const fileByKey = new Map();
  const rootsSeen = new Set();

  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch (error) {
    throw new Error(`Diretorio nao encontrado: ${root}`);
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`O caminho informado nao e um diretorio: ${root}`);
  }

  const scaleEstimate = await estimateDirectoryScale(root);
  const options = normalizeOptions(rawOptions, scaleEstimate);
  await walkDirectory(root, "", 0);
  const indexes = buildIndexes(fileNodes);
  const edges = [];
  const edgeKeys = new Set();
  const dependencyTypes = {};

  for (const node of fileNodes) {
    if (!node.canReadContent) {
      continue;
    }

    let content = "";
    try {
      content = await fs.readFile(node.absolutePath, "utf8");
    } catch (error) {
      node.readError = error.message;
      node.unresolvedDependencies += 1;
      continue;
    }

    const dependencies = extractDependencies(node.relativePath, content);
    node.detectedDependencies = dependencies;

    for (const dependency of dependencies) {
      const resolved = resolveDependency(node.relativePath, dependency, indexes);
      if (resolved) {
        const key = `${node.id}->${resolved.id}:${dependency.type}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          const edge = {
            id: key,
            source: node.id,
            target: resolved.id,
            sourcePath: node.relativePath,
            targetPath: resolved.relativePath,
            type: dependency.type,
            specifier: dependency.specifier,
            line: dependency.line,
            confidence: dependency.confidence
          };
          edges.push(edge);
          node.outgoing += 1;
          resolved.incoming += 1;
          resolved.incomingFrom.push(node.id);
          node.outgoingTo.push(resolved.id);
          dependencyTypes[dependency.type] = (dependencyTypes[dependency.type] || 0) + 1;
        }
      } else if (dependency.localIntent) {
        node.unresolvedDependencies += 1;
        node.unresolvedSpecifiers.push({
          specifier: dependency.specifier,
          type: dependency.type,
          line: dependency.line
        });
      } else {
        node.externalDependencies += 1;
      }
    }
  }

  const components = buildComponents(fileNodes, edges);
  const depthById = computeDepths(fileNodes);
  applyComponentMetadata(fileNodes, components);
  applyImpactMetadata(fileNodes);

  for (const node of fileNodes) {
    node.depth = depthById.get(node.id) || 0;
    classifyNode(node, options);
  }

  for (const component of components) {
    const componentNodes = component.nodeIds.map((id) => fileNodes.find((node) => node.id === id)).filter(Boolean);
    component.depth = Math.max(0, ...componentNodes.map((node) => node.depth));
    component.highRiskNodes = componentNodes.filter((node) => node.risk === "alto").length;
    component.mediumRiskNodes = componentNodes.filter((node) => node.risk === "medio").length;
    component.hasProtected = componentNodes.some((node) => node.classification === "critico_protegido");
    component.risk = component.hasProtected || component.highRiskNodes > 0 ? "alto" : component.mediumRiskNodes > 0 ? "medio" : "baixo";
  }

  const summary = buildSummary(nodes, fileNodes, edges, components, skipped, warnings, startedAt);
  const simulation = buildSimulation(fileNodes);
  const graphViews = buildGraphViews(nodes, fileNodes, edges);

  return {
    schemaVersion: 1,
    algorithm: "A.D.D",
    rootPath: root,
    options,
    scaleEstimate,
    summary,
    nodes: nodes.map(stripInternalNodeFields),
    edges,
    components,
    graphViews,
    simulation,
    skipped,
    warnings
  };

  async function walkDirectory(absoluteDirectory, relativeDirectory, depth) {
    if (depth > options.maxDepth) {
      skipped.push({
        path: relativeDirectory || ".",
        reason: `profundidade maior que ${options.maxDepth}`
      });
      return;
    }

    const directoryKey = normalizeKey(relativeDirectory || ".");
    if (rootsSeen.has(directoryKey)) {
      return;
    }
    rootsSeen.add(directoryKey);

    let entries;
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      skipped.push({
        path: relativeDirectory || ".",
        reason: `sem permissao de leitura: ${error.code || error.message}`
      });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (fileNodes.length >= options.maxFiles) {
        warnings.push(`Limite de ${options.maxFiles} arquivos atingido; o restante foi ignorado.`);
        return;
      }

      if (!options.includeHidden && entry.name.startsWith(".")) {
        skipped.push({ path: normalizeRelative(path.join(relativeDirectory, entry.name)), reason: "oculto" });
        continue;
      }

      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = normalizeRelative(path.join(relativeDirectory, entry.name));
      const protectedReasons = getProtectedReasons(absolutePath, relativePath, entry.name);

      let stat;
      try {
        stat = await fs.lstat(absolutePath);
      } catch (error) {
        skipped.push({ path: relativePath, reason: `sem metadados: ${error.code || error.message}` });
        continue;
      }

      if (stat.isSymbolicLink()) {
        skipped.push({ path: relativePath, reason: "link simbolico ignorado" });
        continue;
      }

      if (entry.isDirectory()) {
        nodes.push({
          id: `dir:${relativePath}`,
          kind: "directory",
          name: entry.name,
          relativePath,
          absolutePath,
          size: 0,
          extension: "",
          protectedReasons,
          classification: protectedReasons.length ? "critico_protegido" : "diretorio",
          risk: protectedReasons.length ? "alto" : "baixo"
        });

        if (shouldSkipDirectory(entry.name, protectedReasons, options)) {
          skipped.push({ path: relativePath, reason: protectedReasons[0] || "diretorio pesado ou gerado" });
          continue;
        }

        await walkDirectory(absolutePath, relativePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({ path: relativePath, reason: "tipo de entrada nao suportado" });
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const lowerName = entry.name.toLowerCase();
      const fileKnowledge = classifyFileKnowledge(relativePath, entry.name, extension);
      const canReadContent = isTextCandidate(lowerName, extension) && stat.size <= options.maxFileSizeBytes;
      const node = {
        id: `file:${relativePath}`,
        kind: "file",
        name: entry.name,
        relativePath,
        absolutePath,
        extension,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        lastAccessedAt: stat.atime.toISOString(),
        daysSinceAccess: daysBetween(stat.atime, new Date()),
        protectedReasons,
        fileKnowledge,
        incoming: 0,
        outgoing: 0,
        incomingFrom: [],
        outgoingTo: [],
        depth: 0,
        impactCount: 0,
        componentId: null,
        componentSize: 1,
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
        canReadContent,
        readError: null,
        detectedDependencies: [],
        unresolvedDependencies: 0,
        unresolvedSpecifiers: [],
        externalDependencies: 0
      };

      if (!canReadContent && isTextCandidate(lowerName, extension)) {
        node.unresolvedDependencies += 1;
        node.unresolvedSpecifiers.push({
          specifier: "<arquivo grande>",
          type: "conteudo_nao_lido",
          line: null
        });
      }

      nodes.push(node);
      fileNodes.push(node);
      fileByKey.set(normalizeKey(relativePath), node);
    }
  }
}

async function estimateDirectoryScale(root) {
  const queue = [{ absolutePath: root, depth: 0 }];
  const visited = new Set();
  const maxEntries = 1600;
  let sampledFiles = 0;
  let sampledDirectories = 0;
  let maxObservedDepth = 0;

  while (queue.length && sampledFiles + sampledDirectories < maxEntries) {
    const current = queue.shift();
    const key = current.absolutePath.toLowerCase();
    if (visited.has(key) || current.depth > 5) {
      continue;
    }
    visited.add(key);
    maxObservedDepth = Math.max(maxObservedDepth, current.depth);

    let entries = [];
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      if (sampledFiles + sampledDirectories >= maxEntries) {
        break;
      }
      if (entry.isDirectory()) {
        sampledDirectories += 1;
        if (!DEFAULT_OPTIONS.skipDirectories.some((name) => name.toLowerCase() === entry.name.toLowerCase())) {
          queue.push({ absolutePath: path.join(current.absolutePath, entry.name), depth: current.depth + 1 });
        }
      } else if (entry.isFile()) {
        sampledFiles += 1;
      }
    }
  }

  const sampledEntries = sampledFiles + sampledDirectories;
  const density = Math.max(1, sampledEntries / Math.max(1, visited.size));
  const estimatedFiles = Math.round(sampledFiles * Math.max(1, density / 8));
  const scale = sampledEntries >= 1400 || estimatedFiles >= 12000
    ? "massivo"
    : sampledEntries >= 700 || estimatedFiles >= 5000
      ? "grande"
      : sampledEntries >= 180 || estimatedFiles >= 1200
        ? "medio"
        : "pequeno";

  return {
    scale,
    sampledFiles,
    sampledDirectories,
    sampledEntries,
    sampledDepth: maxObservedDepth
  };
}

function normalizeOptions(rawOptions, scaleEstimate = { scale: "medio" }) {
  const adaptive = rawOptions.adaptive !== false;
  const adaptiveDefaults = adaptiveProfile(scaleEstimate.scale);
  const options = {
    ...DEFAULT_OPTIONS,
    ...(adaptive ? adaptiveDefaults : {}),
    ...rawOptions
  };

  options.adaptive = adaptive;
  options.maxFiles = clampInteger(options.maxFiles, 100, 50000, DEFAULT_OPTIONS.maxFiles);
  options.maxDepth = clampInteger(options.maxDepth, 1, 64, DEFAULT_OPTIONS.maxDepth);
  options.maxFileSizeBytes = clampInteger(options.maxFileSizeBytes, 16 * 1024, 5 * 1024 * 1024, DEFAULT_OPTIONS.maxFileSizeBytes);
  options.unusedDaysThreshold = clampInteger(options.unusedDaysThreshold, 1, 3650, DEFAULT_OPTIONS.unusedDaysThreshold);
  options.frequentUseDaysThreshold = clampInteger(options.frequentUseDaysThreshold, 1, 60, DEFAULT_OPTIONS.frequentUseDaysThreshold);
  options.skipDirectories = Array.from(new Set([...(DEFAULT_OPTIONS.skipDirectories || []), ...((rawOptions && rawOptions.skipDirectories) || [])]));
  options.includeHidden = Boolean(options.includeHidden);
  return options;
}

function adaptiveProfile(scale) {
  if (scale === "massivo") {
    return {
      maxFiles: 15000,
      maxDepth: 12,
      maxFileSizeBytes: 128 * 1024
    };
  }
  if (scale === "grande") {
    return {
      maxFiles: 10000,
      maxDepth: 15,
      maxFileSizeBytes: 256 * 1024
    };
  }
  if (scale === "medio") {
    return {
      maxFiles: 7000,
      maxDepth: 18,
      maxFileSizeBytes: 512 * 1024
    };
  }
  return {
    maxFiles: 3000,
    maxDepth: 24,
    maxFileSizeBytes: 1024 * 1024
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function daysBetween(date, now) {
  const diff = now.getTime() - date.getTime();
  if (!Number.isFinite(diff) || diff < 0) {
    return 0;
  }
  return Math.floor(diff / 86400000);
}

function shouldSkipDirectory(name, protectedReasons, options) {
  const lowerName = name.toLowerCase();
  const skipNames = new Set(options.skipDirectories.map((item) => item.toLowerCase()));
  return skipNames.has(lowerName) || protectedReasons.some((reason) => reason.includes("diretorio do sistema"));
}

function getProtectedReasons(absolutePath, relativePath, name) {
  const reasons = [];
  const lowerAbsolute = absolutePath.toLowerCase();
  const lowerRelative = normalizeRelative(relativePath).toLowerCase();
  const lowerName = name.toLowerCase();
  const extension = path.extname(lowerName);

  if (PROTECTED_FILE_NAMES.has(lowerName)) {
    reasons.push("arquivo de configuracao/lock");
  }

  if (PROTECTED_EXTENSIONS.has(extension)) {
    reasons.push("executavel ou biblioteca do sistema");
  }

  const knowledge = classifyFileKnowledge(relativePath, name, extension);
  if (knowledge.isSystemEssential) {
    reasons.push("tipo essencial do sistema");
  }
  if (knowledge.isProjectDependency) {
    reasons.push("dependencia/configuracao de projeto");
  }

  if (/(^|[\\/])(\.git|\.hg|\.svn)([\\/]|$)/i.test(absolutePath)) {
    reasons.push("metadados de versionamento");
  }

  if (/(^|[\\/])(windows|system32|winsxs|windowsapps|program files|program files \(x86\)|programdata|recovery|system volume information|\$recycle\.bin)([\\/]|$)/i.test(absolutePath)) {
    reasons.push("diretorio do sistema operacional");
  }

  if (/(^|\/)(windows|system32|winsxs|windowsapps|program files|program files \(x86\)|programdata|recovery|system volume information|\$recycle\.bin)(\/|$)/i.test(lowerRelative)) {
    reasons.push("diretorio do sistema operacional");
  }

  if (lowerAbsolute.includes(`${path.sep}appdata${path.sep}`) && /\.(dll|exe|sys|dat)$/i.test(lowerAbsolute)) {
    reasons.push("artefato sensivel de aplicacao do usuario");
  }

  return Array.from(new Set(reasons));
}

function isTextCandidate(lowerName, extension) {
  return TEXT_EXTENSIONS.has(extension) || SPECIAL_TEXT_FILES.has(lowerName);
}

function buildIndexes(fileNodes) {
  const byRelative = new Map();
  const byBasename = new Map();

  for (const node of fileNodes) {
    byRelative.set(normalizeKey(node.relativePath), node);

    const base = node.name.toLowerCase();
    if (!byBasename.has(base)) {
      byBasename.set(base, []);
    }
    byBasename.get(base).push(node);
  }

  return { byRelative, byBasename };
}

function extractDependencies(relativePath, content) {
  const extension = path.extname(relativePath).toLowerCase();
  const lowerName = path.basename(relativePath).toLowerCase();
  const dependencies = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(extension)) {
      collectRegex(dependencies, line, /\bimport\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g, "import_js", lineNumber, isLocalLikeJs);
      collectRegex(dependencies, line, /\bexport\s+[^"']*?\s+from\s+["']([^"']+)["']/g, "export_js", lineNumber, isLocalLikeJs);
      collectRegex(dependencies, line, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, "require_js", lineNumber, isLocalLikeJs);
      collectRegex(dependencies, line, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, "dynamic_import_js", lineNumber, isLocalLikeJs);
    }

    if (STYLE_EXTENSIONS.includes(extension)) {
      collectRegex(dependencies, line, /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g, "import_css", lineNumber, isLocalUrl);
      collectRegex(dependencies, line, /url\(\s*["']?([^"')]+)["']?\s*\)/g, "asset_css", lineNumber, isLocalUrl);
    }

    if ([".html", ".htm", ".vue", ".svelte"].includes(extension)) {
      collectRegex(dependencies, line, /\b(?:src|href)\s*=\s*["']([^"']+)["']/g, "asset_html", lineNumber, isLocalUrl);
    }

    if (extension === ".py") {
      collectPythonImport(dependencies, line, lineNumber);
    }

    if ([".c", ".cc", ".cpp", ".h", ".hpp"].includes(extension)) {
      collectCInclude(dependencies, line, lineNumber);
    }

    if ([".java", ".kt", ".cs"].includes(extension)) {
      collectRegex(dependencies, line, /^\s*import\s+([\w.]+)\s*;?/g, "import_package", lineNumber, () => true, 0.45);
      collectRegex(dependencies, line, /^\s*using\s+([\w.]+)\s*;?/g, "import_package", lineNumber, () => true, 0.45);
    }

    if (extension === ".go") {
      collectRegex(dependencies, line, /^\s*import\s+["']([^"']+)["']/g, "import_go", lineNumber, isLocalLikeJs, 0.6);
    }

    if (extension === ".rs") {
      collectRegex(dependencies, line, /^\s*mod\s+([a-zA-Z_][\w]*)\s*;/g, "mod_rust", lineNumber, () => true, 0.85);
      collectRegex(dependencies, line, /^\s*use\s+crate::([\w:]+)\s*;?/g, "use_rust", lineNumber, () => true, 0.55);
    }

    if ([".md", ".markdown"].includes(extension) || lowerName.endsWith(".md")) {
      collectRegex(dependencies, line, /!?\[[^\]]*\]\(([^)]+)\)/g, "asset_markdown", lineNumber, isLocalUrl, 0.7);
    }
  }

  return dependencies.filter((dependency, index, all) => {
    const key = `${dependency.type}:${dependency.specifier}:${dependency.line}`;
    return all.findIndex((item) => `${item.type}:${item.specifier}:${item.line}` === key) === index;
  });
}

function collectRegex(dependencies, line, regex, type, lineNumber, localIntentDetector, confidence = 0.9) {
  let match;
  while ((match = regex.exec(line)) !== null) {
    const specifier = cleanSpecifier(match[1]);
    if (!specifier) {
      continue;
    }
    dependencies.push({
      specifier,
      type,
      line: lineNumber,
      localIntent: localIntentDetector(specifier),
      confidence
    });
  }
}

function collectPythonImport(dependencies, line, lineNumber) {
  const fromMatch = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
  if (fromMatch) {
    const moduleName = fromMatch[1].trim();
    const imported = fromMatch[2].split(",").map((item) => item.trim().split(/\s+as\s+/i)[0]).filter(Boolean);
    dependencies.push({
      specifier: moduleName,
      type: "import_python",
      line: lineNumber,
      localIntent: moduleName.startsWith(".") || !isKnownPythonStdlib(moduleName),
      confidence: moduleName.startsWith(".") ? 0.9 : 0.55
    });

    if (moduleName.startsWith(".")) {
      for (const item of imported) {
        if (/^[a-zA-Z_][\w]*$/.test(item)) {
          dependencies.push({
            specifier: `${moduleName}.${item}`,
            type: "import_python",
            line: lineNumber,
            localIntent: true,
            confidence: 0.8
          });
        }
      }
    }
    return;
  }

  const importMatch = line.match(/^\s*import\s+(.+)$/);
  if (importMatch) {
    const modules = importMatch[1].split(",").map((item) => item.trim().split(/\s+as\s+/i)[0]).filter(Boolean);
    for (const moduleName of modules) {
      dependencies.push({
        specifier: moduleName,
        type: "import_python",
        line: lineNumber,
        localIntent: !isKnownPythonStdlib(moduleName),
        confidence: 0.55
      });
    }
  }
}

function collectCInclude(dependencies, line, lineNumber) {
  const match = line.match(/^\s*#\s*include\s+(["<])([^">]+)[">]/);
  if (!match) {
    return;
  }
  dependencies.push({
    specifier: match[2].trim(),
    type: match[1] === "\"" ? "include_local" : "include_sistema",
    line: lineNumber,
    localIntent: match[1] === "\"",
    confidence: match[1] === "\"" ? 0.95 : 0.35
  });
}

function cleanSpecifier(value) {
  return String(value || "")
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/^['"]|['"]$/g, "");
}

function isLocalLikeJs(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("~");
}

function isLocalUrl(specifier) {
  if (!specifier || specifier.startsWith("#")) {
    return false;
  }
  return !/^(?:[a-z]+:)?\/\//i.test(specifier) && !/^(?:data|mailto|tel):/i.test(specifier);
}

function resolveDependency(importerRelativePath, dependency, indexes) {
  const specifier = cleanSpecifier(dependency.specifier);
  if (!specifier || !isLocalUrl(specifier)) {
    return null;
  }

  const importerDirectory = normalizeRelative(path.dirname(importerRelativePath));
  const type = dependency.type;
  const bareImportTypes = new Set(["import_js", "export_js", "require_js", "dynamic_import_js", "import_go"]);

  if (!dependency.localIntent && bareImportTypes.has(type)) {
    return null;
  }

  if (type === "import_python") {
    return resolvePython(importerDirectory, specifier, indexes);
  }

  if (type === "mod_rust") {
    return firstExisting([
      path.posix.join(importerDirectory, `${specifier}.rs`),
      path.posix.join(importerDirectory, specifier, "mod.rs")
    ], indexes);
  }

  if (type === "use_rust") {
    const rustPath = specifier.replace(/::/g, "/");
    return firstExisting([
      path.posix.join("src", `${rustPath}.rs`),
      path.posix.join("src", rustPath, "mod.rs"),
      `${rustPath}.rs`,
      path.posix.join(rustPath, "mod.rs")
    ], indexes);
  }

  if (type === "import_package") {
    const packagePath = specifier.replace(/\./g, "/");
    return firstExisting([
      `${packagePath}.java`,
      `${packagePath}.kt`,
      `${packagePath}.cs`,
      path.posix.join("src", "main", "java", `${packagePath}.java`),
      path.posix.join("src", "main", "kotlin", `${packagePath}.kt`)
    ], indexes);
  }

  let base;
  if (specifier.startsWith("/")) {
    base = specifier.slice(1);
  } else if (specifier.startsWith("~")) {
    base = specifier.slice(1);
  } else {
    base = path.posix.join(importerDirectory, specifier);
  }

  const extensionSet = extensionGuessesFor(type);
  const candidates = candidatePaths(base, extensionSet);
  return firstExisting(candidates, indexes);
}

function resolvePython(importerDirectory, specifier, indexes) {
  if (specifier.startsWith(".")) {
    const dots = specifier.match(/^\.+/)[0].length;
    const moduleName = specifier.slice(dots).replace(/^\./, "");
    let base = importerDirectory === "." ? "" : importerDirectory;
    for (let index = 1; index < dots; index += 1) {
      base = normalizeRelative(path.posix.dirname(base || "."));
      if (base === ".") {
        base = "";
      }
    }
    const modulePath = moduleName.replace(/\./g, "/");
    const combined = modulePath ? path.posix.join(base, modulePath) : base;
    return firstExisting(candidatePaths(combined, PY_EXTENSIONS), indexes);
  }

  const modulePath = specifier.replace(/\./g, "/");
  return firstExisting(candidatePaths(modulePath, PY_EXTENSIONS), indexes);
}

function extensionGuessesFor(type) {
  if (type.includes("js")) {
    return JS_EXTENSIONS;
  }
  if (type.includes("css")) {
    return STYLE_EXTENSIONS;
  }
  if (type.includes("html") || type.includes("markdown")) {
    return HTML_EXTENSIONS;
  }
  if (type.includes("include")) {
    return C_EXTENSIONS;
  }
  if (type.includes("go")) {
    return [".go"];
  }
  return [...JS_EXTENSIONS, ...HTML_EXTENSIONS, ...PY_EXTENSIONS, ...C_EXTENSIONS, ...RUST_EXTENSIONS];
}

function candidatePaths(base, extensions) {
  const normalizedBase = normalizeRelative(base).replace(/^\.\//, "");
  const candidates = [normalizedBase];
  const currentExtension = path.posix.extname(normalizedBase);

  if (!currentExtension) {
    for (const extension of extensions) {
      if (extension.startsWith("/")) {
        candidates.push(`${normalizedBase}${extension}`);
      } else {
        candidates.push(`${normalizedBase}${extension}`);
      }
    }

    for (const indexExtension of extensions.filter((extension) => !extension.startsWith("/"))) {
      candidates.push(path.posix.join(normalizedBase, `index${indexExtension}`));
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function firstExisting(candidates, indexes) {
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    if (indexes.byRelative.has(key)) {
      return indexes.byRelative.get(key);
    }
  }
  return null;
}

function buildComponents(fileNodes, edges) {
  const adjacency = new Map(fileNodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set();
  const components = [];

  for (const node of fileNodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const stack = [node.id];
    const nodeIds = [];
    visited.add(node.id);

    while (stack.length) {
      const current = stack.pop();
      nodeIds.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    const edgeCount = edges.filter((edge) => nodeIds.includes(edge.source) || nodeIds.includes(edge.target)).length;
    components.push({
      id: `component:${components.length + 1}`,
      nodeIds,
      nodeCount: nodeIds.length,
      edgeCount,
      depth: 0,
      risk: "baixo",
      hasProtected: false,
      highRiskNodes: 0,
      mediumRiskNodes: 0
    });
  }

  return components.sort((a, b) => b.nodeCount - a.nodeCount);
}

function applyComponentMetadata(fileNodes, components) {
  const byId = new Map(fileNodes.map((node) => [node.id, node]));
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      const node = byId.get(nodeId);
      if (node) {
        node.componentId = component.id;
        node.componentSize = component.nodeCount;
      }
    }
  }
}

function applyImpactMetadata(fileNodes) {
  const byId = new Map(fileNodes.map((node) => [node.id, node]));

  for (const node of fileNodes) {
    const impacted = new Set();
    const queue = [...node.incomingFrom];

    while (queue.length) {
      const currentId = queue.shift();
      if (impacted.has(currentId)) {
        continue;
      }
      impacted.add(currentId);
      const current = byId.get(currentId);
      if (current) {
        queue.push(...current.incomingFrom);
      }
    }

    node.impactCount = impacted.size;
  }
}

function computeDepths(fileNodes) {
  const byId = new Map(fileNodes.map((node) => [node.id, node]));
  const memo = new Map();
  const visiting = new Set();

  function depthFor(nodeId) {
    if (memo.has(nodeId)) {
      return memo.get(nodeId);
    }
    if (visiting.has(nodeId)) {
      return 0;
    }
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    let depth = 0;
    for (const nextId of node?.outgoingTo || []) {
      depth = Math.max(depth, 1 + depthFor(nextId));
    }
    visiting.delete(nodeId);
    memo.set(nodeId, depth);
    return depth;
  }

  for (const node of fileNodes) {
    depthFor(node.id);
  }

  return memo;
}

function classifyNode(node, options = DEFAULT_OPTIONS) {
  const reasons = [...node.protectedReasons];
  let riskScore = 0;
  const knowledge = node.fileKnowledge || {};
  const isSystemProtected = node.protectedReasons.some((reason) => reason.includes("sistema") || reason.includes("executavel") || reason.includes("biblioteca"));
  const isConfigProtected = node.protectedReasons.length > 0;
  const dependencyLoad = node.incoming + node.outgoing + node.impactCount;
  const isUnused = node.daysSinceAccess >= options.unusedDaysThreshold;
  const isFrequentlyUsed = node.daysSinceAccess <= options.frequentUseDaysThreshold;
  const isLowValueGenerated = Boolean(knowledge.isLowValueGenerated);
  const isUserContent = Boolean(knowledge.isUserContent);
  const dependencyImpact = dependencyImpactFor(node);

  if (reasons.length) {
    riskScore += 80;
  }
  riskScore += node.incoming * 12;
  riskScore += node.outgoing * 4;
  riskScore += node.depth * 6;
  riskScore += Math.min(80, node.impactCount * 10);
  riskScore += Math.min(30, Math.max(0, node.componentSize - 1) * 3);
  riskScore += node.unresolvedDependencies * 15;
  if (node.daysSinceAccess <= 1) {
    riskScore += 24;
    reasons.push("uso muito recente");
  } else if (node.daysSinceAccess <= 4) {
    riskScore += 14;
    reasons.push("uso recente");
  } else if (node.daysSinceAccess <= 10) {
    riskScore += 7;
    reasons.push("uso na ultima semana");
  } else if (node.daysSinceAccess >= 60 && node.incoming === 0) {
    riskScore -= 5;
    reasons.push("sem uso recente detectado");
  }
  if (node.size > 1024 * 1024) {
    riskScore += 10;
    reasons.push("arquivo grande");
  }
  if (node.incoming > 0) {
    reasons.push(`${node.incoming} dependencia(s) apontam para este arquivo`);
  }
  if (node.outgoing > 0) {
    reasons.push(`${node.outgoing} dependencia(s) usadas por este arquivo`);
  }
  if (node.impactCount > 0) {
    reasons.push(`${node.impactCount} arquivo(s) seriam afetados transitivamente`);
  }
  if (node.unresolvedDependencies > 0) {
    reasons.push("dependencias nao resolvidas");
  }
  if (isLowValueGenerated) {
    reasons.push("tipo gerado/cache de baixo valor");
    riskScore -= 14;
  }
  if (isUserContent && isFrequentlyUsed) {
    reasons.push("conteudo do usuario usado nos ultimos 7 dias");
  }

  if (node.protectedReasons.length) {
    node.classification = "critico_protegido";
    node.risk = "alto";
    node.simulationAction = "proteger_nao_mover";
    node.relocationDecision = "nao_mover";
  } else if (node.incoming === 0 && node.outgoing === 0 && node.unresolvedDependencies === 0) {
    node.classification = "isolado";
    node.risk = riskScore >= 30 ? "medio" : "baixo";
    node.simulationAction = node.risk === "baixo" ? "candidato_para_realocacao" : "revisar_uso_recente";
    node.relocationDecision = node.risk === "baixo" ? "pode_mexer" : "averiguar";
  } else if (node.incoming > 0 && node.outgoing > 0) {
    node.classification = "dependente_provedor";
    node.risk = riskScore >= 65 || node.impactCount >= 6 ? "alto" : "medio";
    node.simulationAction = "revisar_dependencias";
    node.relocationDecision = node.risk === "alto" ? "nao_mover" : "averiguar";
  } else if (node.incoming > 0) {
    node.classification = "provedor";
    node.risk = node.incoming >= 4 || node.impactCount >= 8 || riskScore >= 60 ? "alto" : "medio";
    node.simulationAction = node.risk === "alto" ? "nao_mover" : "revisar_antes_de_mover";
    node.relocationDecision = node.risk === "alto" ? "nao_mover" : "averiguar";
  } else if (node.outgoing > 0) {
    node.classification = "dependente";
    node.risk = node.unresolvedDependencies > 0 || riskScore >= 45 ? "medio" : "baixo";
    node.simulationAction = node.risk === "baixo" ? "mover_com_dependencias" : "revisar_antes_de_mover";
    node.relocationDecision = node.risk === "baixo" ? "pode_mexer" : "averiguar";
  } else {
    node.classification = "dependente";
    node.risk = "medio";
    node.simulationAction = "revisar_dependencias_nao_resolvidas";
    node.relocationDecision = "averiguar";
  }

  if (node.unresolvedDependencies > 0 && node.risk === "baixo") {
    node.risk = "medio";
    node.relocationDecision = "averiguar";
  }

  node.impact = {
    system: isSystemProtected ? "afeta_sistema" : isConfigProtected ? "protegido" : "nao_afeta_sistema",
    user: userImpactFor(node, { isFrequentlyUsed, isUnused }),
    dependencies: dependencyImpact
  };
  node.utilityStatus = utilityStatusFor(node, {
    isSystemProtected,
    isConfigProtected,
    isUnused,
    isFrequentlyUsed,
    isLowValueGenerated,
    isUserContent,
    dependencyImpact
  });
  node.deletionDecision = deletionDecisionFor(node, {
    isSystemProtected,
    isConfigProtected,
    isUnused,
    isFrequentlyUsed,
    isLowValueGenerated,
    isUserContent,
    dependencyImpact,
    dependencyLoad
  });

  if (node.deletionDecision === "pode_apagar" || node.deletionDecision === "inutil_provavel") {
    node.relocationDecision = "pode_mexer";
  } else if (node.deletionDecision === "nao_apagar") {
    node.relocationDecision = "nao_mover";
  } else {
    node.relocationDecision = "averiguar";
  }

  node.riskScore = riskScore;
  node.riskReasons = Array.from(new Set(reasons)).slice(0, 8);
}

function dependencyImpactFor(node) {
  if (node.unresolvedDependencies > 0) {
    return "incerto";
  }
  if (node.fileKnowledge?.isLowValueGenerated && node.incoming === 0 && node.impactCount === 0) {
    return node.outgoing > 0 ? "baixo" : "nenhum";
  }
  if (node.impactCount >= 8 || node.incoming >= 4 || node.componentSize >= 12) {
    return "alto";
  }
  if (node.impactCount >= 2 || node.incoming >= 2 || node.componentSize >= 5) {
    return "medio";
  }
  if (node.incoming > 0 || node.outgoing > 0 || node.impactCount > 0) {
    return "baixo";
  }
  return "nenhum";
}

function userImpactFor(node, { isFrequentlyUsed, isUnused }) {
  if (node.protectedReasons.length > 0) {
    return "alto";
  }
  if (isFrequentlyUsed && node.fileKnowledge?.isUserContent) {
    return "alto";
  }
  if (isFrequentlyUsed && !node.fileKnowledge?.isLowValueGenerated) {
    return "medio";
  }
  if (node.daysSinceAccess <= 10 || node.incoming >= 2 || node.impactCount >= 2) {
    return "medio";
  }
  if (isUnused && node.incoming === 0 && node.impactCount === 0) {
    return "baixo";
  }
  return "baixo";
}

function utilityStatusFor(node, context) {
  if (context.isSystemProtected) {
    return "sistema";
  }
  if (context.isConfigProtected) {
    return "protegido";
  }
  if (context.isLowValueGenerated && node.incoming === 0 && node.impactCount === 0 && node.unresolvedDependencies === 0) {
    return context.isUnused ? "inutil_provavel" : "baixo_uso";
  }
  if (context.isFrequentlyUsed && context.isUserContent) {
    return "usado_pelo_usuario";
  }
  if (context.dependencyImpact === "alto" || context.dependencyImpact === "medio") {
    return "dependencia_relevante";
  }
  if (context.isUnused && node.incoming === 0 && node.outgoing === 0 && node.impactCount === 0 && node.unresolvedDependencies === 0) {
    return "inutil_provavel";
  }
  if (context.isUnused && node.impactCount === 0 && node.unresolvedDependencies === 0) {
    return "baixo_uso";
  }
  return "utilidade_incerta";
}

function deletionDecisionFor(node, context) {
  if (context.isSystemProtected || context.isConfigProtected) {
    return "nao_apagar";
  }
  if (context.isLowValueGenerated && node.incoming === 0 && node.impactCount === 0 && node.unresolvedDependencies === 0) {
    return context.isUnused ? "pode_apagar" : "inutil_provavel";
  }
  if (context.isFrequentlyUsed && context.isUserContent) {
    return "nao_apagar";
  }
  if (context.dependencyImpact === "alto") {
    return "nao_apagar";
  }
  if (node.unresolvedDependencies > 0 || context.dependencyImpact === "incerto") {
    return "averiguar";
  }
  if (context.dependencyImpact === "medio") {
    return "averiguar";
  }
  if (context.isUnused && node.incoming === 0 && node.outgoing === 0 && node.impactCount === 0) {
    return "pode_apagar";
  }
  if (context.isUnused && node.impactCount === 0 && context.dependencyLoad <= 2) {
    return "inutil_provavel";
  }
  return "averiguar";
}

function buildSummary(nodes, fileNodes, edges, components, skipped, warnings, startedAt) {
  const byClassification = countBy(fileNodes, "classification");
  const byRisk = countBy(fileNodes, "risk");
  const byDeletionDecision = countBy(fileNodes, "deletionDecision");
  const byUtilityStatus = countBy(fileNodes, "utilityStatus");
  const directories = nodes.filter((node) => node.kind === "directory").length;
  return {
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    directories,
    files: fileNodes.length,
    entries: directories + fileNodes.length,
    edges: edges.length,
    components: components.length,
    skipped: skipped.length,
    warnings: warnings.length,
    byClassification,
    byRisk,
    byDeletionDecision,
    byUtilityStatus,
    byKnowledge: {
      systemEssential: fileNodes.filter((node) => node.fileKnowledge?.isSystemEssential).length,
      projectDependency: fileNodes.filter((node) => node.fileKnowledge?.isProjectDependency).length,
      userContent: fileNodes.filter((node) => node.fileKnowledge?.isUserContent).length,
      lowValueGenerated: fileNodes.filter((node) => node.fileKnowledge?.isLowValueGenerated).length,
      usedLast7Days: fileNodes.filter((node) => node.daysSinceAccess <= 7).length
    },
    candidateLowRisk: fileNodes.filter((node) => node.risk === "baixo" && node.classification === "isolado").length,
    canDelete: fileNodes.filter((node) => node.deletionDecision === "pode_apagar").length,
    probablyUseless: fileNodes.filter((node) => node.utilityStatus === "inutil_provavel" || node.deletionDecision === "inutil_provavel").length,
    mustKeep: fileNodes.filter((node) => node.deletionDecision === "nao_apagar").length,
    protected: fileNodes.filter((node) => node.classification === "critico_protegido").length,
    unresolvedDependencies: fileNodes.reduce((sum, node) => sum + node.unresolvedDependencies, 0),
    recentlyAccessed: fileNodes.filter((node) => node.daysSinceAccess <= 4).length,
    staleCandidates: fileNodes.filter((node) => node.daysSinceAccess >= 30 && node.incoming === 0 && node.risk === "baixo").length,
    highImpactProviders: fileNodes.filter((node) => node.impactCount >= 6 || node.incoming >= 4).length,
    totalTransitiveImpact: fileNodes.reduce((sum, node) => sum + node.impactCount, 0)
  };
}

function buildSimulation(fileNodes) {
  const buckets = {
    isolados: [],
    dependentes: [],
    provedores: [],
    mistos: [],
    protegidos: [],
    revisar: []
  };

  for (const node of fileNodes) {
    const item = {
      id: node.id,
      path: node.relativePath,
      risk: node.risk,
      incoming: node.incoming,
      outgoing: node.outgoing,
      depth: node.depth,
      action: node.simulationAction
    };

    if (node.classification === "isolado") {
      buckets.isolados.push(item);
    } else if (node.classification === "dependente") {
      buckets.dependentes.push(item);
    } else if (node.classification === "provedor") {
      buckets.provedores.push(item);
    } else if (node.classification === "dependente_provedor") {
      buckets.mistos.push(item);
    } else if (node.classification === "critico_protegido") {
      buckets.protegidos.push(item);
    } else {
      buckets.revisar.push(item);
    }
  }

  const decisionGroups = {
    pode_apagar: fileNodes
      .filter((node) => node.deletionDecision === "pode_apagar")
      .map(toSimulationDecision),
    inutil_provavel: fileNodes
      .filter((node) => node.deletionDecision === "inutil_provavel")
      .map(toSimulationDecision),
    averiguar: fileNodes
      .filter((node) => node.deletionDecision === "averiguar")
      .map(toSimulationDecision),
    nao_apagar: fileNodes
      .filter((node) => node.deletionDecision === "nao_apagar")
      .map(toSimulationDecision)
  };

  return {
    buckets,
    decisionGroups,
    recommendation: {
      pode_apagar: "Nao afeta sistema, nao afeta dependencias relevantes e parece fora de uso.",
      inutil_provavel: "Baixo uso e baixo impacto; bom candidato para A.R.E, mas ainda merece confirmacao.",
      averiguar: "Ha uso, dependencia ou incerteza suficiente para pedir revisao.",
      nao_apagar: "Afeta sistema, usuario recente ou dependencia relevante; tratar como protegido."
    }
  };
}

function toSimulationDecision(node) {
  return {
    id: node.id,
    path: node.relativePath,
    risk: node.risk,
    utilityStatus: node.utilityStatus,
    deletionDecision: node.deletionDecision,
    impact: node.impact,
    knowledgeCategories: node.fileKnowledge?.categories || [],
    action: node.simulationAction,
    reason: simulationReason(node),
    incoming: node.incoming,
    outgoing: node.outgoing,
    impactCount: node.impactCount,
    riskScore: node.riskScore,
    riskReasons: node.riskReasons,
    daysSinceAccess: node.daysSinceAccess
  };
}

function simulationReason(node) {
  if (node.protectedReasons.length) {
    return node.protectedReasons.join(", ");
  }
  if (node.deletionDecision === "pode_apagar") {
    return "sem uso recente, sem dependencia e fora de area protegida";
  }
  if (node.deletionDecision === "inutil_provavel") {
    return "baixo uso e impacto pequeno no grafo";
  }
  if (node.incoming >= 4) {
    return "muitas dependencias apontam para este arquivo";
  }
  if (node.impactCount >= 6) {
    return "impacto transitivo alto no grafo";
  }
  if (node.daysSinceAccess <= 4) {
    return "uso recente detectado";
  }
  if (node.unresolvedDependencies > 0) {
    return "ha dependencias nao resolvidas";
  }
  if (node.incoming === 0 && node.outgoing === 0) {
    return "isolado no grafo local";
  }
  return "impacto limitado, mas conectado ao grafo";
}

function buildGraphViews(nodes, fileNodes, edges) {
  return {
    far: buildDirectoryGraph(nodes, fileNodes, edges),
    medium: buildGroupedGraph(fileNodes, edges),
    close: {
      mode: "proximo",
      description: "arquivos individuais",
      nodes: fileNodes.map(toCloseGraphNode),
      edges: edges.map((edge) => ({
        ...edge,
        weight: 1,
        label: edge.type
      }))
    }
  };
}

function buildDirectoryGraph(nodes, fileNodes, edges) {
  const directoryNodes = nodes.filter((node) => node.kind === "directory");
  const directoryCounts = countDirectoriesByTopLevel(directoryNodes);
  const groups = new Map();

  for (const file of fileNodes) {
    const directory = topDirectory(file.relativePath);
    if (!groups.has(directory)) {
      groups.set(directory, []);
    }
    groups.get(directory).push(file);
  }

  const viewNodes = Array.from(groups.entries()).map(([directory, files]) => {
    const incoming = files.reduce((sum, file) => sum + file.incoming, 0);
    const outgoing = files.reduce((sum, file) => sum + file.outgoing, 0);
    return {
      id: `far:${directory}`,
      kind: "directory_group",
      label: directory,
      relativePath: directory,
      risk: maxRisk(files),
      classification: "diretorio",
      fileCount: files.length,
      directoryCount: directoryCounts.get(directory) || 0,
      incoming,
      outgoing,
      impactCount: files.reduce((sum, file) => sum + file.impactCount, 0),
      deletionDecision: aggregateDeletionDecision(files),
      utilityStatus: aggregateUtilityStatus(files),
      depth: Math.max(0, ...files.map((file) => file.depth)),
      size: files.reduce((sum, file) => sum + file.size, 0),
      children: files.map((file) => file.id),
      groupReason: "diretorio agregado por dependencias"
    };
  });

  const nodeForFile = new Map();
  for (const file of fileNodes) {
    nodeForFile.set(file.id, `far:${topDirectory(file.relativePath)}`);
  }

  return {
    mode: "distante",
    description: "diretorios agregados",
    nodes: viewNodes,
    edges: aggregateGraphEdges(edges, nodeForFile)
  };
}

function buildGroupedGraph(fileNodes, edges) {
  const edgeTargetsBySource = new Map(fileNodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    edgeTargetsBySource.get(edge.source)?.push(edge.target);
  }

  const groups = new Map();
  for (const file of fileNodes) {
    const key = mediumGroupKey(file, edgeTargetsBySource);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(file);
  }

  const nodeForFile = new Map();
  const viewNodes = [];
  let groupIndex = 0;

  for (const [key, files] of groups.entries()) {
    const forceIndividual = files.length === 1;
    if (forceIndividual) {
      const node = toCloseGraphNode(files[0]);
      node.id = `medium:file:${files[0].relativePath}`;
      node.kind = "important_file";
      node.groupReason = "arquivo principal";
      nodeForFile.set(files[0].id, node.id);
      viewNodes.push(node);
      continue;
    }

    groupIndex += 1;
    const first = files[0];
    const extension = first.extension || "sem_ext";
    const groupReason = key.startsWith("shared:")
      ? "arquivos com dependencias em comum"
      : "arquivos agrupados por pasta, tipo e risco";
    const label = key.startsWith("shared:")
      ? `${files.length} arquivos dependentes`
      : `${files.length} ${extension} em ${topDirectory(first.relativePath)}`;
    const id = `medium:group:${groupIndex}`;
    for (const file of files) {
      nodeForFile.set(file.id, id);
    }
    viewNodes.push({
      id,
      kind: "dependency_group",
      label,
      relativePath: topDirectory(first.relativePath),
      risk: maxRisk(files),
      classification: commonClassification(files),
      fileCount: files.length,
      directoryCount: new Set(files.map((file) => topDirectory(file.relativePath))).size,
      incoming: files.reduce((sum, file) => sum + file.incoming, 0),
      outgoing: files.reduce((sum, file) => sum + file.outgoing, 0),
      impactCount: files.reduce((sum, file) => sum + file.impactCount, 0),
      deletionDecision: aggregateDeletionDecision(files),
      utilityStatus: aggregateUtilityStatus(files),
      depth: Math.max(0, ...files.map((file) => file.depth)),
      size: files.reduce((sum, file) => sum + file.size, 0),
      children: files.map((file) => file.id),
      groupReason
    });
  }

  return {
    mode: "medio",
    description: "arquivos principais e grupos de dependencia",
    nodes: viewNodes,
    edges: aggregateGraphEdges(edges, nodeForFile)
  };
}

function toCloseGraphNode(node) {
  return {
    id: node.id,
    kind: "file",
    label: node.name,
    name: node.name,
    relativePath: node.relativePath,
    extension: node.extension,
    risk: node.risk,
    classification: node.classification,
    fileCount: 1,
    directoryCount: 0,
    incoming: node.incoming,
    outgoing: node.outgoing,
    impactCount: node.impactCount,
    depth: node.depth,
    size: node.size,
    daysSinceAccess: node.daysSinceAccess,
    action: node.simulationAction,
    deletionDecision: node.deletionDecision,
    utilityStatus: node.utilityStatus,
    impact: node.impact,
    knowledgeCategories: node.fileKnowledge?.categories || [],
    relocationDecision: node.relocationDecision,
    riskScore: node.riskScore,
    riskReasons: node.riskReasons,
    children: [node.id],
    groupReason: "arquivo individual"
  };
}

function aggregateGraphEdges(edges, nodeForFile) {
  const aggregate = new Map();

  for (const edge of edges) {
    const source = nodeForFile.get(edge.source);
    const target = nodeForFile.get(edge.target);
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
      item.samples.push({
        sourcePath: edge.sourcePath,
        targetPath: edge.targetPath,
        type: edge.type
      });
    }
  }

  return Array.from(aggregate.values()).map((edge) => ({
    ...edge,
    label: Object.entries(edge.types)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join(", ")
  }));
}

function mediumGroupKey(file, edgeTargetsBySource) {
  const degree = file.incoming + file.outgoing;
  if (file.risk === "alto" || file.classification === "critico_protegido" || degree >= 4) {
    return `single:${file.id}`;
  }

  const targets = (edgeTargetsBySource.get(file.id) || []).slice().sort();
  if (targets.length) {
    return `shared:${targets.slice(0, 5).join("|")}`;
  }

  return `kind:${topDirectory(file.relativePath)}:${file.extension || "sem_ext"}:${file.risk}:${file.classification}`;
}

function countDirectoriesByTopLevel(directoryNodes) {
  const counts = new Map();
  for (const node of directoryNodes) {
    const top = topDirectory(node.relativePath);
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  return counts;
}

function topDirectory(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized === "." || !normalized.includes("/")) {
    return ".";
  }
  return normalized.split("/")[0];
}

function maxRisk(files) {
  if (files.some((file) => file.risk === "alto")) {
    return "alto";
  }
  if (files.some((file) => file.risk === "medio")) {
    return "medio";
  }
  return "baixo";
}

function commonClassification(files) {
  const classifications = new Set(files.map((file) => file.classification));
  if (classifications.size === 1) {
    return files[0].classification;
  }
  if (classifications.has("critico_protegido")) {
    return "critico_protegido";
  }
  return "dependente_provedor";
}

function aggregateDeletionDecision(files) {
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

function aggregateUtilityStatus(files) {
  const statuses = new Set(files.map((file) => file.utilityStatus));
  if (statuses.has("sistema")) {
    return "sistema";
  }
  if (statuses.has("protegido")) {
    return "protegido";
  }
  if (statuses.has("dependencia_relevante")) {
    return "dependencia_relevante";
  }
  if (statuses.has("usado_pelo_usuario")) {
    return "usado_pelo_usuario";
  }
  if (statuses.has("utilidade_incerta")) {
    return "utilidade_incerta";
  }
  if (statuses.has("baixo_uso")) {
    return "baixo_uso";
  }
  return "inutil_provavel";
}

function countBy(items, field) {
  return items.reduce((accumulator, item) => {
    const key = item[field] || "desconhecido";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function stripInternalNodeFields(node) {
  const {
    absolutePath,
    incomingFrom,
    outgoingTo,
    detectedDependencies,
    canReadContent,
    readError,
    ...publicNode
  } = node;

  return {
    ...publicNode,
    readError: readError || null,
    dependencySamples: (detectedDependencies || []).slice(0, 12)
  };
}

function normalizeRelative(value) {
  const normalized = String(value || ".").replace(/\\/g, "/");
  return path.posix.normalize(normalized).replace(/^\.$/, ".");
}

function normalizeKey(value) {
  return normalizeRelative(value).toLowerCase();
}

function isKnownPythonStdlib(moduleName) {
  const root = moduleName.split(".")[0];
  return PYTHON_STDLIB.has(root);
}

const PYTHON_STDLIB = new Set([
  "abc",
  "argparse",
  "asyncio",
  "base64",
  "collections",
  "contextlib",
  "csv",
  "dataclasses",
  "datetime",
  "functools",
  "hashlib",
  "http",
  "io",
  "itertools",
  "json",
  "logging",
  "math",
  "os",
  "pathlib",
  "random",
  "re",
  "shutil",
  "sqlite3",
  "statistics",
  "subprocess",
  "sys",
  "tempfile",
  "time",
  "typing",
  "unittest",
  "urllib",
  "uuid"
]);

module.exports = {
  analyzeDirectory,
  extractDependencies,
  resolveDependency,
  DEFAULT_OPTIONS
};
