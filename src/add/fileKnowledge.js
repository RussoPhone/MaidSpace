const fs = require("node:fs");
const path = require("node:path");

const knowledgePath = path.resolve(__dirname, "../../data/add-file-knowledge.json");

let cachedKnowledge = null;

function loadFileKnowledge() {
  if (cachedKnowledge) {
    return cachedKnowledge;
  }

  try {
    cachedKnowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
  } catch (error) {
    cachedKnowledge = fallbackKnowledge();
  }

  return cachedKnowledge;
}

const ARCHIVE_EXTENSIONS = new Set([
  ".7z",
  ".bak",
  ".gz",
  ".iso",
  ".old",
  ".rar",
  ".tar",
  ".tgz",
  ".zip"
]);

const EXECUTABLE_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".dll",
  ".dylib",
  ".exe",
  ".msi",
  ".ps1",
  ".sh",
  ".so",
  ".sys"
]);

const SOURCE_EXTENSIONS = new Set([
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
  ".mjs",
  ".php",
  ".py",
  ".rs",
  ".scss",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);

const DOCUMENT_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".md",
  ".pdf",
  ".ppt",
  ".pptx",
  ".rtf",
  ".tsv",
  ".txt",
  ".xls",
  ".xlsx"
]);

function classifyFileKnowledge(relativePath, fileName, extension, metadata = {}) {
  const knowledge = loadFileKnowledge();
  const normalizedPath = normalizePath(relativePath);
  const normalizedName = String(fileName || "").toLowerCase();
  const normalizedExtension = String(extension || "").toLowerCase();
  const size = Number(metadata.size || 0);

  const categories = [];
  for (const [key, bucket] of Object.entries(knowledge)) {
    if (!bucket || typeof bucket !== "object") {
      continue;
    }
    if (matchesBucket(bucket, normalizedPath, normalizedName, normalizedExtension)) {
      categories.push(key);
    }
  }

  const typeCategory = typeCategoryFor(normalizedName, normalizedExtension);
  const riskCategory = riskCategoryFor(categories, typeCategory);
  const lastUseBucket = ageBucket(metadata.lastAccessedAt || metadata.accessedAt || metadata.modifiedAt);
  const createdBucket = ageBucket(metadata.createdAt || metadata.birthtime || metadata.modifiedAt);
  const modifiedBucket = ageBucket(metadata.modifiedAt);
  const sizeBucket = sizeBucketFor(size);
  const dependencyGroup = [
    "dpn",
    riskCategory,
    typeCategory,
    normalizedExtension || "sem_ext",
    lastUseBucket,
    createdBucket
  ].join(":");

  return {
    categories,
    isSystemEssential: categories.includes("systemEssential"),
    isProjectDependency: categories.includes("projectDependency"),
    isUserContent: categories.includes("userContent"),
    isLowValueGenerated: categories.includes("lowValueGenerated"),
    isArchive: typeCategory === "arquivo_compactado",
    isExecutable: typeCategory === "executavel",
    isSourceCode: typeCategory === "codigo_fonte",
    typeCategory,
    riskCategory,
    dependencyGroup,
    lastUseBucket,
    createdBucket,
    modifiedBucket,
    sizeBucket,
    recentUse: knowledge.recentUse || fallbackKnowledge().recentUse
  };
}

function typeCategoryFor(normalizedName, normalizedExtension) {
  if (EXECUTABLE_EXTENSIONS.has(normalizedExtension)) {
    return "executavel";
  }
  if (ARCHIVE_EXTENSIONS.has(normalizedExtension)) {
    return "arquivo_compactado";
  }
  if (SOURCE_EXTENSIONS.has(normalizedExtension) || ["dockerfile", "makefile"].includes(normalizedName)) {
    return "codigo_fonte";
  }
  if (DOCUMENT_EXTENSIONS.has(normalizedExtension)) {
    return "documento_usuario";
  }
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp3", ".wav", ".flac", ".mp4", ".mov", ".mkv"].includes(normalizedExtension)) {
    return "midia_usuario";
  }
  if ([".tmp", ".temp", ".log", ".cache", ".dmp", ".chk", ".crdownload", ".part"].includes(normalizedExtension)) {
    return "baixo_valor";
  }
  return "desconhecido";
}

function riskCategoryFor(categories, typeCategory) {
  if (categories.includes("systemEssential") || typeCategory === "executavel") {
    return "sistema";
  }
  if (categories.includes("projectDependency") || typeCategory === "codigo_fonte") {
    return "dependencia";
  }
  if (categories.includes("lowValueGenerated") || typeCategory === "baixo_valor") {
    return "gerado_baixo_valor";
  }
  if (categories.includes("userContent") || typeCategory === "documento_usuario" || typeCategory === "midia_usuario") {
    return "conteudo_usuario";
  }
  if (typeCategory === "arquivo_compactado") {
    return "arquivo_pesado";
  }
  return "incerto";
}

function ageBucket(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "idade_desconhecida";
  }

  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (!Number.isFinite(days) || days < 0) {
    return "futuro";
  }
  if (days <= 1) {
    return "0_1d";
  }
  if (days <= 7) {
    return "2_7d";
  }
  if (days <= 30) {
    return "8_30d";
  }
  if (days <= 180) {
    return "31_180d";
  }
  if (days <= 365) {
    return "181_365d";
  }
  return "365d_plus";
}

function sizeBucketFor(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0b";
  }
  if (size < 1024 * 1024) {
    return "ate_1mb";
  }
  if (size < 100 * 1024 * 1024) {
    return "1_100mb";
  }
  if (size < 1024 * 1024 * 1024) {
    return "100mb_1gb";
  }
  return "1gb_plus";
}

function matchesBucket(bucket, normalizedPath, normalizedName, normalizedExtension) {
  return includes(bucket.names, normalizedName)
    || includes(bucket.extensions, normalizedExtension)
    || (bucket.pathFragments || []).some((fragment) => normalizedPath.includes(normalizePath(fragment)));
}

function includes(items, value) {
  return Array.isArray(items) && items.map((item) => String(item).toLowerCase()).includes(value);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function fallbackKnowledge() {
  return {
    recentUse: {
      frequentWindowDays: 7,
      unusedWindowDays: 30
    }
  };
}

module.exports = {
  classifyFileKnowledge,
  loadFileKnowledge
};
