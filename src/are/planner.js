const path = require("node:path");

const CODE_EXTENSIONS = new Set([
  ".astro", ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java",
  ".js", ".jsx", ".kt", ".mjs", ".php", ".py", ".rs", ".svelte",
  ".ts", ".tsx", ".vue"
]);

const ASSET_EXTENSIONS = new Set([
  ".ai", ".css", ".gif", ".ico", ".jpeg", ".jpg", ".less", ".mp3",
  ".mp4", ".png", ".scss", ".svg", ".wav", ".webp"
]);

const DOC_EXTENSIONS = new Set([
  ".csv", ".doc", ".docx", ".md", ".pdf", ".ppt", ".pptx", ".rtf",
  ".txt", ".xls", ".xlsx"
]);

const INSTALLER_EXTENSIONS = new Set([".exe", ".msi", ".iso", ".dmg", ".pkg", ".deb", ".rpm"]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".xz"]);
const MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".wav", ".flac", ".mp4", ".mov", ".mkv"]);

const MODE_ORDER = ["baixo", "medio", "alto"];
const RISK_WEIGHT = {
  baixo: 1,
  medio: 2,
  alto: 3,
  critico: 4
};

const MODE_RULES = {
  baixo: {
    label: "baixo",
    description: "Conservador: realoca apenas arquivos claramente inuteis, antigos, isolados e sem acesso/modificacao recente.",
    maxRisk: 1,
    minAccessDays: 30,
    minModifiedDays: 30,
    requireSafeProfile: true,
    packageMode: "arquivo"
  },
  medio: {
    label: "medio",
    description: "Equilibrado: realoca arquivos ou blocos antigos que nao afetem sistema, projetos recentes ou dependencias importantes.",
    maxRisk: 2,
    minAccessDays: 21,
    minModifiedDays: 7,
    requireSafeProfile: false,
    packageMode: "componente"
  },
  alto: {
    label: "alto",
    description: "Agressivo assistido: busca o maior ganho possivel sem tocar sistema, estruturas protegidas, ciclos ou uso recente.",
    maxRisk: 3,
    minAccessDays: 3,
    minModifiedDays: 0,
    requireSafeProfile: false,
    packageMode: "componente"
  }
};

function generateRelocationPlan(addReport) {
  const files = (addReport.nodes || []).filter((node) => node.kind === "file");
  const cycles = addReport.cycles || [];
  const context = {
    nodeByPath: new Map(files.map((node) => [node.relativePath, node])),
    componentMap: buildComponentMap(files)
  };
  const spatialEntries = files.map((node) => analyzeSpaceCandidate(node, context));
  const operations = spatialEntries.map((entry) => planFile(entry.node, entry));
  const proposedStructure = buildProposedStructure(operations, cycles);
  const groups = groupOperations(operations);
  const spaceModes = buildSpaceModes(spatialEntries, context.nodeByPath);
  const blockedFiles = spatialEntries
    .filter((entry) => entry.modes.length === 0)
    .map(toBlockedFile)
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));
  const safetyReport = buildSafetyReport(spaceModes, blockedFiles, cycles);
  const totalBytes = files.reduce((sum, node) => sum + (node.size || 0), 0);
  const blockedBytes = blockedFiles.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
  const relocationSimulation = buildRelocationSimulation(spaceModes, totalBytes, blockedFiles);

  return {
    schemaVersion: 4,
    algorithm: "A.R.E",
    safeMode: true,
    generatedAt: new Date().toISOString(),
    rootPath: addReport.rootPath,
    objective: "calcular quanto espaco pode ser realocado com seguranca usando o relatorio do A.D.D",
    question: "Quanto pode ser realocado?",
    summary: {
      totalFiles: files.length,
      totalBytes,
      totalHuman: formatBytes(totalBytes),
      suggestions: operations.length,
      keepInPlace: operations.filter((item) => item.action === "manter").length,
      moveCandidates: operations.filter((item) => item.action === "sugerir_mover").length,
      reviewCandidates: operations.filter((item) => item.action === "revisar").length,
      safeTrashCandidates: operations.filter((item) => item.action === "sugerir_lixeira_segura").length,
      blockedFiles: blockedFiles.length,
      blockedBytes,
      blockedHuman: formatBytes(blockedBytes),
      reallocatable: {
        baixo: spaceModes.baixo.reallocatableBytes,
        medio: spaceModes.medio.reallocatableBytes,
        alto: spaceModes.alto.reallocatableBytes
      },
      reallocatableHuman: {
        baixo: spaceModes.baixo.reallocatableHuman,
        medio: spaceModes.medio.reallocatableHuman,
        alto: spaceModes.alto.reallocatableHuman
      },
      cycleBlocks: cycles.length
    },
    relocationSimulation,
    spaceModes,
    candidatesByMode: {
      baixo: spaceModes.baixo.candidates,
      medio: spaceModes.medio.candidates,
      alto: spaceModes.alto.candidates
    },
    blockedFiles,
    safetyReport,
    proposedStructure,
    groups,
    operations,
    cycleBlocks: cycles.map((cycle) => ({
      id: cycle.id,
      type: cycle.type,
      nodeCount: cycle.nodeCount,
      files: cycle.nodeIds
        .map((id) => files.find((node) => node.id === id)?.relativePath)
        .filter(Boolean),
      suggestion: "manter junto; nao separar sem revisao manual"
    })),
    rules: [
      "Nao move, apaga ou altera arquivos automaticamente.",
      "Modo baixo aceita apenas arquivo isolado, antigo, risco baixo e perfil espacial seguro.",
      "Modo medio aceita pacotes antigos quando o componente inteiro pode ser realocado junto.",
      "Modo alto e agressivo, mas bloqueia sistema, protegidos, ciclos, uso recente e dependencias essenciais.",
      "O A.R.E calcula ganho espacial; a execucao real depende de confirmacao do usuario."
    ],
    note: "Simulacao espacial: bytes realocados representam o que sairia do diretorio principal se o usuario confirmasse a realocacao indicada."
  };
}

function analyzeSpaceCandidate(node, context) {
  const profile = analyzeSpatialProfile(node);
  const absoluteBlockReasons = absoluteBlockReasonsFor(node);
  const packageNodesByMode = {};
  const packagePathsByMode = {};
  const packageBytesByMode = {};
  const modes = [];
  const modeReasons = {};

  for (const mode of MODE_ORDER) {
    const packageNodes = packageForMode(node, mode, context);
    packageNodesByMode[mode] = packageNodes;
    packagePathsByMode[mode] = packageNodes.map((item) => item.relativePath);
    packageBytesByMode[mode] = packageNodes.reduce((sum, item) => sum + (item.size || 0), 0);

    const result = modeEligibilityReason(mode, node, packageNodes, profile, absoluteBlockReasons);
    modeReasons[mode] = result.reason;
    if (result.allowed) {
      modes.push(mode);
    }
  }

  return {
    node,
    path: node.relativePath,
    sizeBytes: node.size || 0,
    packageBytes: packageBytesByMode.alto || node.size || 0,
    packagePaths: packagePathsByMode.alto || [node.relativePath],
    packagePathsByMode,
    packageBytesByMode,
    absoluteBlockReasons,
    modes,
    modeReasons,
    spatialProfile: profile,
    targetDirectory: targetByType(node),
    justification: justificationFor(node, modes, absoluteBlockReasons, modeReasons, profile)
  };
}

function modeEligibilityReason(mode, node, packageNodes, profile, absoluteBlockReasons) {
  const rule = MODE_RULES[mode];
  const riskWeight = RISK_WEIGHT[node.risk] || 2;
  const accessAge = effectiveAccessAge(packageNodes);
  const modifiedAge = minAge(packageNodes, "modifiedAt");
  const packageBlockReasons = packageBlockReasonsFor(packageNodes, mode);

  if (absoluteBlockReasons.length > 0) {
    return { allowed: false, reason: absoluteBlockReasons[0] };
  }
  if (packageBlockReasons.length > 0) {
    return { allowed: false, reason: packageBlockReasons[0] };
  }
  if (riskWeight > rule.maxRisk) {
    return { allowed: false, reason: `risco estrutural ${node.risk} acima do modo ${mode}` };
  }
  if (accessAge < rule.minAccessDays) {
    return { allowed: false, reason: `acesso recente no pacote (${accessAge} dia(s)); exige ${rule.minAccessDays}+` };
  }
  if (rule.minModifiedDays > 0 && modifiedAge < rule.minModifiedDays) {
    return { allowed: false, reason: `modificacao recente no pacote (${modifiedAge} dia(s)); exige ${rule.minModifiedDays}+` };
  }
  if (mode === "baixo") {
    if (node.classification !== "isolado") {
      return { allowed: false, reason: "modo baixo exige classificacao isolado pelo A.D.D" };
    }
    if ((node.incoming || 0) > 0 || (node.outgoing || 0) > 0 || (node.impactCount || 0) > 0) {
      return { allowed: false, reason: "modo baixo exige impacto zero em dependencias" };
    }
    if (node.risk !== "baixo") {
      return { allowed: false, reason: "modo baixo exige risco estrutural baixo" };
    }
    if (rule.requireSafeProfile && !profile.safeLow) {
      return { allowed: false, reason: "modo baixo exige local ou tipo seguro para limpeza" };
    }
  }
  if (mode === "medio" && packageNodes.some((item) => item.risk === "alto")) {
    return { allowed: false, reason: "modo medio nao aceita risco alto no pacote" };
  }

  return { allowed: true, reason: `elegivel no modo ${mode}` };
}

function absoluteBlockReasonsFor(node) {
  const reasons = [];
  const impactSystem = node.impact?.system;

  if (node.inCycle) {
    reasons.push("faz parte de bloco interdependente");
  }
  if (node.risk === "critico") {
    reasons.push("risco estrutural critico");
  }
  if (node.protectedReasons?.length) {
    reasons.push(node.protectedReasons.join(", "));
  }
  if (impactSystem === "afeta_sistema" || impactSystem === "protegido") {
    reasons.push("arquivo de sistema ou protegido");
  }
  if ((node.unresolvedDependencies || 0) > 0) {
    reasons.push("dependencias nao resolvidas");
  }

  return Array.from(new Set(reasons));
}

function packageBlockReasonsFor(packageNodes, mode) {
  const reasons = [];
  const rule = MODE_RULES[mode];

  for (const item of packageNodes) {
    const systemImpact = item.impact?.system;
    if (item.inCycle) {
      reasons.push(`pacote contem ciclo: ${item.relativePath}`);
    }
    if (item.risk === "critico") {
      reasons.push(`pacote contem risco critico: ${item.relativePath}`);
    }
    if ((RISK_WEIGHT[item.risk] || 2) > rule.maxRisk) {
      reasons.push(`pacote contem risco ${item.risk}: ${item.relativePath}`);
    }
    if (item.protectedReasons?.length || systemImpact === "afeta_sistema" || systemImpact === "protegido") {
      reasons.push(`pacote contem arquivo protegido: ${item.relativePath}`);
    }
    if ((item.unresolvedDependencies || 0) > 0) {
      reasons.push(`pacote contem dependencia incerta: ${item.relativePath}`);
    }
  }

  return Array.from(new Set(reasons));
}

function buildSpaceModes(spatialEntries, nodeByPath) {
  const result = {};

  for (const mode of MODE_ORDER) {
    const entries = spatialEntries.filter((entry) => entry.modes.includes(mode));
    const packages = buildModePackages(entries, nodeByPath, mode);
    const candidates = entries
      .map((entry) => toModeCandidate(entry, mode))
      .sort((a, b) => b.packageBytes - a.packageBytes || a.path.localeCompare(b.path));
    const reallocatableBytes = packages.reduce((sum, item) => sum + item.bytes, 0);

    result[mode] = {
      mode,
      label: MODE_RULES[mode].label,
      description: MODE_RULES[mode].description,
      criteria: criteriaForMode(mode),
      reallocatableBytes,
      reallocatableHuman: formatBytes(reallocatableBytes),
      fileCount: candidates.length,
      packageCount: packages.length,
      packageFileCount: packages.reduce((sum, item) => sum + item.fileCount, 0),
      packages,
      candidates
    };
  }

  return result;
}

function buildModePackages(entries, nodeByPath, mode) {
  const packages = new Map();

  for (const entry of entries) {
    const packagePaths = (entry.packagePathsByMode?.[mode] || [entry.path]).slice().sort();
    const key = packagePaths.join("|");
    if (!packages.has(key)) {
      const files = packagePaths
        .map((relativePath) => nodeByPath.get(relativePath))
        .filter(Boolean);
      const bytes = files.reduce((sum, node) => sum + (node.size || 0), 0);
      packages.set(key, {
        id: `are:${mode}:${packages.size + 1}`,
        mode,
        bytes,
        human: formatBytes(bytes),
        fileCount: files.length,
        files: packagePaths,
        candidateRoots: [],
        maxRisk: maxRisk(files),
        classifications: Array.from(new Set(files.map((node) => node.classification))).sort(),
        targetDirectory: targetByType(entry.node),
        justification: entry.justification
      });
    }
    packages.get(key).candidateRoots.push(entry.path);
  }

  return Array.from(packages.values()).sort((a, b) => b.bytes - a.bytes || a.files[0].localeCompare(b.files[0]));
}

function buildRelocationSimulation(spaceModes, totalBytes, blockedFiles) {
  const simulation = {};

  for (const mode of MODE_ORDER) {
    const spaceMode = spaceModes[mode];
    const relocatedBytes = spaceMode.reallocatableBytes;
    const remainingBytes = Math.max(0, totalBytes - relocatedBytes);
    const relocatedPercent = totalBytes > 0 ? Math.round((relocatedBytes / totalBytes) * 1000) / 10 : 0;

    simulation[mode] = {
      mode,
      beforeBytes: totalBytes,
      beforeHuman: formatBytes(totalBytes),
      relocatedBytes,
      relocatedHuman: formatBytes(relocatedBytes),
      remainingBytes,
      remainingHuman: formatBytes(remainingBytes),
      relocatedPercent,
      remainingPercent: Math.max(0, Math.round((100 - relocatedPercent) * 10) / 10),
      packageCount: spaceMode.packageCount || 0,
      candidateFiles: spaceMode.fileCount || 0,
      blockedFiles: blockedFiles.length,
      simulatedMoves: (spaceMode.packages || []).map((item) => ({
        action: "simular_realocacao_de_pacote",
        packageId: item.id,
        from: "diretorio_analisado",
        to: simulatedTargetFor(mode, item),
        bytes: item.bytes,
        human: item.human,
        fileCount: item.fileCount,
        files: item.files,
        candidateRoots: item.candidateRoots,
        justification: item.justification
      })),
      explanation: relocatedBytes > 0
        ? `Simulacao: ${formatBytes(relocatedBytes)} sairiam do diretorio principal no modo ${mode}.`
        : `Simulacao: nenhum pacote passou nos criterios do modo ${mode}; o ganho estimado e 0 B.`
    };
  }

  return simulation;
}

function toModeCandidate(entry, mode) {
  return {
    mode,
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    sizeHuman: formatBytes(entry.sizeBytes),
    packageBytes: entry.packageBytesByMode[mode],
    packageHuman: formatBytes(entry.packageBytesByMode[mode]),
    packagePaths: entry.packagePathsByMode[mode],
    packageFileCount: entry.packagePathsByMode[mode].length,
    targetDirectory: entry.targetDirectory,
    classification: entry.node.classification,
    risk: entry.node.risk,
    structuralRisk: entry.node.risk,
    deletionDecision: entry.node.deletionDecision,
    relocationDecision: entry.node.relocationDecision,
    lastAccessedAt: entry.node.lastAccessedAt,
    lastModifiedAt: entry.node.modifiedAt,
    daysSinceAccess: entry.node.daysSinceAccess,
    daysSinceModified: daysSince(entry.node.modifiedAt),
    incoming: entry.node.incoming || 0,
    outgoing: entry.node.outgoing || 0,
    dependencyImpact: entry.node.impact?.dependencies || "desconhecido",
    userImpact: entry.node.impact?.user || "desconhecido",
    systemImpact: entry.node.impact?.system || "desconhecido",
    spatialCategories: entry.spatialProfile.categories,
    justification: entry.justification,
    requiresConfirmation: true
  };
}

function toBlockedFile(entry) {
  const reasons = Array.from(new Set([
    ...entry.absoluteBlockReasons,
    entry.modeReasons.alto,
    "nao atingiu os criterios do modo alto"
  ])).filter(Boolean);

  return {
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    sizeHuman: formatBytes(entry.sizeBytes),
    classification: entry.node.classification,
    risk: entry.node.risk,
    structuralRisk: entry.node.risk,
    deletionDecision: entry.node.deletionDecision,
    lastAccessedAt: entry.node.lastAccessedAt,
    lastModifiedAt: entry.node.modifiedAt,
    daysSinceAccess: entry.node.daysSinceAccess,
    daysSinceModified: daysSince(entry.node.modifiedAt),
    incoming: entry.node.incoming || 0,
    outgoing: entry.node.outgoing || 0,
    spatialCategories: entry.spatialProfile.categories,
    reason: reasons[0] || "nao elegivel para realocacao segura",
    blockingReasons: reasons
  };
}

function justificationFor(node, modes, absoluteBlockReasons, modeReasons, profile) {
  if (!modes.length) {
    return absoluteBlockReasons[0] || modeReasons.alto || "nao passou nos criterios espaciais do A.R.E";
  }
  if (modes.includes("baixo")) {
    return `isolado, antigo e com perfil seguro (${profile.categories.join(", ") || "baixo risco"})`;
  }
  if (modes.includes("medio")) {
    return "pacote antigo pode ser realocado junto sem tocar sistema ou uso recente";
  }
  if (modes.includes("alto")) {
    return "candidato agressivo assistido; pacote completo nao toca sistema nem estruturas protegidas";
  }
  return "elegivel com confirmacao";
}

function buildComponentMap(files) {
  const map = new Map();
  for (const node of files) {
    const key = node.componentId || node.id;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(node);
  }
  return map;
}

function packageForMode(node, mode, context) {
  if (MODE_RULES[mode].packageMode === "arquivo") {
    return [node];
  }
  const componentNodes = context.componentMap.get(node.componentId || node.id) || [node];
  return componentNodes.slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function maxRisk(files) {
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

function simulatedTargetFor(mode, packageItem) {
  if (mode === "baixo") {
    return packageItem.targetDirectory === "/lixeira_segura" ? "/lixeira_segura" : "/arquivo_morto/baixo_risco";
  }
  if (mode === "medio") {
    return "/armazenamento_secundario/pacotes_antigos";
  }
  return "/armazenamento_secundario/realocacao_agressiva";
}

function analyzeSpatialProfile(node) {
  const relativePath = String(node.relativePath || "").replace(/\\/g, "/").toLowerCase();
  const name = String(node.name || path.posix.basename(relativePath)).toLowerCase();
  const extension = String(node.extension || path.posix.extname(name)).toLowerCase();
  const categories = [];

  if (node.fileKnowledge?.isLowValueGenerated || /(^|\/)(cache|tmp|temp|logs?|\.cache)(\/|$)/.test(relativePath)) {
    categories.push("cache_temporario_log");
  }
  if (/(^|\/)(downloads|download)(\/|$)/.test(relativePath)) {
    categories.push("downloads_antigos");
  }
  if (/(^|\/)(build|dist|out|target|coverage|\.next\/cache|__pycache__)(\/|$)/.test(relativePath)) {
    categories.push("build_ou_artefato_antigo");
  }
  if (INSTALLER_EXTENSIONS.has(extension) || /\b(setup|installer|install|driver)\b/.test(name)) {
    categories.push("instalador_antigo");
  }
  if (ARCHIVE_EXTENSIONS.has(extension) || /\.(bak|old|backup|tmp|temp|log)$/i.test(name)) {
    categories.push("backup_pacote_ou_log_antigo");
  }
  if (/\b(copy|copia|cópia|duplicado|duplicate)\b|\(\d+\)/i.test(name)) {
    categories.push("duplicata_possivel");
  }
  if (MEDIA_EXTENSIONS.has(extension) && (node.incoming || 0) === 0 && (node.outgoing || 0) === 0) {
    categories.push("midia_solta_sem_vinculo");
  }

  return {
    categories: Array.from(new Set(categories)),
    safeLow: categories.length > 0
  };
}

function criteriaForMode(mode) {
  if (mode === "baixo") {
    return [
      "nao afeta nenhum outro arquivo",
      "ninguem depende dele",
      "nao depende de arquivos importantes",
      "nao faz parte de ciclo",
      "nao e arquivo do sistema",
      "nao foi acessado ou modificado recentemente",
      "classificacao isolado e risco estrutural baixo",
      "perfil seguro: downloads antigos, cache, temporario, duplicata, log, instalador antigo ou midia solta"
    ];
  }
  if (mode === "medio") {
    return [
      "nao afeta o sistema operacional",
      "nao e dependencia de arquivos usados recentemente",
      "nao foi acessado ha bastante tempo",
      "pode ser movido como pacote completo",
      "nao quebra projetos recentes",
      "nao esta em area critica do sistema"
    ];
  }
  return [
    "nao e essencial ao sistema operacional",
    "nao esta em diretorio critico",
    "nao e usado por programas ativos ou recentes",
    "nao e dependencia de algo importante",
    "pode ser movido para armazenamento secundario, lixeira segura ou arquivo morto",
    "mesmo com dependencias, o grupo completo pode ser realocado"
  ];
}

function sumUniqueBytes(entries, nodeByPath, mode) {
  let total = 0;
  for (const relativePath of uniquePackagePaths(entries, mode)) {
    total += nodeByPath.get(relativePath)?.size || 0;
  }
  return total;
}

function uniquePackagePaths(entries, mode) {
  const paths = new Set();
  for (const entry of entries) {
    for (const packagePath of entry.packagePathsByMode?.[mode] || [entry.path]) {
      paths.add(packagePath);
    }
  }
  return paths;
}

function buildSafetyReport(spaceModes, blockedFiles, cycles) {
  const highest = spaceModes.alto.reallocatableBytes;
  const blockedBytes = blockedFiles.reduce((sum, item) => sum + item.sizeBytes, 0);
  const riskLevel = cycles.length > 0 || blockedFiles.some((item) => item.risk === "critico")
    ? "critico"
    : blockedFiles.some((item) => item.risk === "alto")
      ? "alto"
      : "medio";

  return {
    riskLevel,
    blockedBytes,
    blockedHuman: formatBytes(blockedBytes),
    bestCaseReallocatableBytes: highest,
    bestCaseReallocatableHuman: formatBytes(highest),
    text: [
      `Modo baixo pode realocar ${spaceModes.baixo.reallocatableHuman}.`,
      `Modo medio pode realocar ${spaceModes.medio.reallocatableHuman}.`,
      `Modo alto pode realocar ${spaceModes.alto.reallocatableHuman}.`,
      `${blockedFiles.length} arquivo(s) foram bloqueados por risco, uso recente, sistema, ciclo ou dependencia compartilhada.`,
      "Nenhuma acao e executada automaticamente; o A.R.E so calcula ganho espacial e prepara a decisao do usuario."
    ].join(" ")
  };
}

function planFile(node, spatialEntry) {
  const base = {
    source: node.relativePath,
    currentDirectory: directoryOf(node.relativePath),
    classification: node.classification,
    risk: node.risk,
    deletionDecision: node.deletionDecision,
    relocationDecision: node.relocationDecision,
    sizeBytes: node.size || 0,
    sizeHuman: formatBytes(node.size || 0),
    packageBytes: spatialEntry.packageBytes,
    packageHuman: formatBytes(spatialEntry.packageBytes),
    eligibleModes: spatialEntry.modes,
    requiresConfirmation: true,
    dependenciesToMoveWith: spatialEntry.packagePathsByMode.alto.filter((item) => item !== node.relativePath),
    dependentsToProtect: node.dependents || [],
    cycleBlockId: node.cycleBlockId || null
  };

  if (!spatialEntry.modes.length) {
    return {
      ...base,
      action: "manter",
      targetDirectory: base.currentDirectory,
      reason: spatialEntry.justification,
      priority: node.risk === "critico" ? "critica" : "alta"
    };
  }

  if (node.deletionDecision === "pode_apagar") {
    return {
      ...base,
      action: "sugerir_lixeira_segura",
      targetDirectory: "/lixeira_segura",
      reason: spatialEntry.justification,
      priority: "baixa"
    };
  }

  if (node.deletionDecision === "inutil_provavel") {
    return {
      ...base,
      action: "revisar",
      targetDirectory: "/revisar/baixo_uso",
      reason: spatialEntry.justification,
      priority: "baixa"
    };
  }

  return {
    ...base,
    action: "sugerir_mover",
    targetDirectory: spatialEntry.targetDirectory,
    reason: spatialEntry.justification,
    priority: spatialEntry.modes.includes("baixo") ? "baixa" : spatialEntry.modes.includes("medio") ? "media" : "alta"
  };
}

function buildProposedStructure(operations, cycles) {
  const directories = new Map([
    ["/src", "codigo e arquivos de projeto"],
    ["/assets", "imagens, estilos, audio, video e midia"],
    ["/docs", "documentos e notas"],
    ["/tests", "testes detectados por nome ou caminho"],
    ["/isolados", "arquivos sem dependencias locais"],
    ["/revisar", "arquivos que exigem decisao humana"],
    ["/revisar/baixo_uso", "candidatos pouco usados"],
    ["/revisar/mistos", "arquivos dependentes e provedores"],
    ["/revisar/blocos_interdependentes", "ciclos detectados por DFS"],
    ["/lixeira_segura", "candidatos a descarte com confirmacao"]
  ]);

  return Array.from(directories.entries()).map(([directory, purpose]) => ({
    directory,
    purpose,
    plannedItems: operations.filter((item) => item.targetDirectory === directory).length,
    plannedBytes: operations
      .filter((item) => item.targetDirectory === directory)
      .reduce((sum, item) => sum + (item.sizeBytes || 0), 0),
    cycleBlocks: directory === "/revisar/blocos_interdependentes" ? cycles.length : 0
  }));
}

function groupOperations(operations) {
  return operations.reduce((groups, operation) => {
    const key = operation.action;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(operation);
    return groups;
  }, {});
}

function targetByType(node) {
  const lowerPath = String(node.relativePath || "").toLowerCase();
  const extension = String(node.extension || "").toLowerCase();

  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(lowerPath) || /\.(test|spec)\.[a-z0-9]+$/.test(lowerPath)) {
    return "/tests";
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return "/src";
  }
  if (ASSET_EXTENSIONS.has(extension)) {
    return "/assets";
  }
  if (DOC_EXTENSIONS.has(extension)) {
    return "/docs";
  }
  return "/revisar";
}

function directoryOf(relativePath) {
  const directory = path.posix.dirname(String(relativePath || ".").replace(/\\/g, "/"));
  return directory === "." ? "/" : `/${directory}`;
}

function minAge(nodes, dateField, fallbackAgeField = null) {
  return Math.min(...nodes.map((node) => {
    if (fallbackAgeField && Number.isFinite(Number(node[fallbackAgeField]))) {
      return Number(node[fallbackAgeField]);
    }
    return daysSince(node[dateField]);
  }));
}

function effectiveAccessAge(nodes) {
  const accessAge = minAge(nodes, "lastAccessedAt", "daysSinceAccess");
  const modifiedAge = minAge(nodes, "modifiedAt");
  const scannerLikelyTouchedAccess = nodes.length > 0 && nodes.every((node) => Number(node.daysSinceAccess ?? 0) <= 1);

  if (scannerLikelyTouchedAccess && modifiedAge > accessAge) {
    return modifiedAge;
  }

  return accessAge;
}

function daysSince(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return 0;
  }
  return Math.floor(diff / 86400000);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

module.exports = {
  generateRelocationPlan,
  gerar_plano_relocacao: generateRelocationPlan
};
