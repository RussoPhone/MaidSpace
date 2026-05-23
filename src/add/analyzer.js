const fs = require("node:fs/promises");
const path = require("node:path");

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
  maxFiles: 5000,
  maxDepth: 18,
  maxFileSizeBytes: 512 * 1024,
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
    "System Volume Information",
    "Windows"
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
  const options = normalizeOptions(rawOptions);
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

  for (const node of fileNodes) {
    node.depth = depthById.get(node.id) || 0;
    classifyNode(node);
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

  return {
    schemaVersion: 1,
    algorithm: "A.D.D",
    rootPath: root,
    options,
    summary,
    nodes: nodes.map(stripInternalNodeFields),
    edges,
    components,
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
        protectedReasons,
        incoming: 0,
        outgoing: 0,
        incomingFrom: [],
        outgoingTo: [],
        depth: 0,
        classification: "isolado",
        risk: "baixo",
        riskScore: 0,
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

function normalizeOptions(rawOptions) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...rawOptions
  };

  options.maxFiles = clampInteger(options.maxFiles, 100, 50000, DEFAULT_OPTIONS.maxFiles);
  options.maxDepth = clampInteger(options.maxDepth, 1, 64, DEFAULT_OPTIONS.maxDepth);
  options.maxFileSizeBytes = clampInteger(options.maxFileSizeBytes, 16 * 1024, 5 * 1024 * 1024, DEFAULT_OPTIONS.maxFileSizeBytes);
  options.skipDirectories = Array.from(new Set([...(DEFAULT_OPTIONS.skipDirectories || []), ...((rawOptions && rawOptions.skipDirectories) || [])]));
  options.includeHidden = Boolean(options.includeHidden);
  return options;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
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

  if (/(^|[\\/])(\.git|\.hg|\.svn)([\\/]|$)/i.test(absolutePath)) {
    reasons.push("metadados de versionamento");
  }

  if (/(^|[\\/])(windows|program files|program files \(x86\)|programdata|system volume information|\$recycle\.bin)([\\/]|$)/i.test(absolutePath)) {
    reasons.push("diretorio do sistema operacional");
  }

  if (/(^|\/)(windows|program files|program files \(x86\)|programdata|system volume information|\$recycle\.bin)(\/|$)/i.test(lowerRelative)) {
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

function classifyNode(node) {
  const reasons = [...node.protectedReasons];
  let riskScore = 0;

  if (reasons.length) {
    riskScore += 80;
  }
  riskScore += node.incoming * 12;
  riskScore += node.outgoing * 4;
  riskScore += node.depth * 6;
  riskScore += node.unresolvedDependencies * 15;
  if (node.size > 1024 * 1024) {
    riskScore += 10;
  }

  if (node.protectedReasons.length) {
    node.classification = "critico_protegido";
    node.risk = "alto";
    node.simulationAction = "proteger_nao_mover";
  } else if (node.incoming === 0 && node.outgoing === 0 && node.unresolvedDependencies === 0) {
    node.classification = "isolado";
    node.risk = "baixo";
    node.simulationAction = "separar_como_isolado";
  } else if (node.incoming > 0 && node.outgoing > 0) {
    node.classification = "dependente_provedor";
    node.risk = riskScore >= 55 ? "alto" : "medio";
    node.simulationAction = "revisar_com_grafo";
  } else if (node.incoming > 0) {
    node.classification = "provedor";
    node.risk = node.incoming >= 4 || riskScore >= 55 ? "alto" : "medio";
    node.simulationAction = "manter_com_dependentes";
  } else if (node.outgoing > 0) {
    node.classification = "dependente";
    node.risk = node.unresolvedDependencies > 0 || riskScore >= 45 ? "medio" : "baixo";
    node.simulationAction = "pode_mover_com_fornecedores";
  } else {
    node.classification = "dependente";
    node.risk = "medio";
    node.simulationAction = "revisar_dependencias_nao_resolvidas";
  }

  if (node.unresolvedDependencies > 0 && node.risk === "baixo") {
    node.risk = "medio";
  }

  node.riskScore = riskScore;
}

function buildSummary(nodes, fileNodes, edges, components, skipped, warnings, startedAt) {
  const byClassification = countBy(fileNodes, "classification");
  const byRisk = countBy(fileNodes, "risk");
  return {
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    directories: nodes.filter((node) => node.kind === "directory").length,
    files: fileNodes.length,
    edges: edges.length,
    components: components.length,
    skipped: skipped.length,
    warnings: warnings.length,
    byClassification,
    byRisk,
    candidateLowRisk: fileNodes.filter((node) => node.risk === "baixo" && node.classification === "isolado").length,
    protected: fileNodes.filter((node) => node.classification === "critico_protegido").length,
    unresolvedDependencies: fileNodes.reduce((sum, node) => sum + node.unresolvedDependencies, 0)
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

  return {
    buckets,
    recommendation: {
      baixo: "Arquivos isolados e sem pendencias detectadas podem ser candidatos para separacao.",
      medio: "Arquivos dependentes exigem mover junto com fornecedores ou revisar imports nao resolvidos.",
      alto: "Arquivos protegidos, provedores fortes ou com grande profundidade nao devem ser alterados pelo A.R.E sem revisao."
    }
  };
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
