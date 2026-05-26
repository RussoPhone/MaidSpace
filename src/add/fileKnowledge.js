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

function classifyFileKnowledge(relativePath, fileName, extension) {
  const knowledge = loadFileKnowledge();
  const normalizedPath = normalizePath(relativePath);
  const normalizedName = String(fileName || "").toLowerCase();
  const normalizedExtension = String(extension || "").toLowerCase();

  const categories = [];
  for (const [key, bucket] of Object.entries(knowledge)) {
    if (!bucket || typeof bucket !== "object") {
      continue;
    }
    if (matchesBucket(bucket, normalizedPath, normalizedName, normalizedExtension)) {
      categories.push(key);
    }
  }

  return {
    categories,
    isSystemEssential: categories.includes("systemEssential"),
    isProjectDependency: categories.includes("projectDependency"),
    isUserContent: categories.includes("userContent"),
    isLowValueGenerated: categories.includes("lowValueGenerated"),
    recentUse: knowledge.recentUse || fallbackKnowledge().recentUse
  };
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
