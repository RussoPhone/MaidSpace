const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeDirectory } = require("../src/add/analyzer");

test("A.D.D classifica dependente, provedor, isolado e protegido", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "src-add-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "app.js"), "import { helper } from './lib.js';\nimport './style.css';\nhelper();\n");
  await fs.writeFile(path.join(root, "src", "lib.js"), "export function helper() { return true; }\n");
  await fs.writeFile(path.join(root, "src", "style.css"), "body { color: #111; }\n");
  await fs.writeFile(path.join(root, "src", "orphan.txt"), "sem dependencia\n");
  await fs.writeFile(path.join(root, "src", "recent.tmp"), "temporario\n");
  await fs.writeFile(path.join(root, "package.json"), "{\"scripts\":{\"start\":\"node src/app.js\"}}\n");
  const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(root, "src", "orphan.txt"), oldDate, oldDate);

  const result = await analyzeDirectory(root, {
    maxFiles: 100,
    maxDepth: 5,
    maxFileSizeBytes: 128 * 1024
  });

  const byPath = new Map(result.nodes.map((node) => [node.relativePath, node]));

  assert.equal(result.summary.files, 6);
  assert.equal(result.summary.edges, 2);
  assert.equal(byPath.get("src/app.js").classification, "dependente");
  assert.equal(byPath.get("src/lib.js").classification, "provedor");
  assert.equal(byPath.get("src/lib.js").impactCount, 1);
  assert.equal(byPath.get("src/lib.js").deletionDecision, "averiguar");
  assert.equal(byPath.get("src/style.css").classification, "provedor");
  assert.equal(byPath.get("src/orphan.txt").classification, "isolado");
  assert.equal(byPath.get("src/orphan.txt").risk, "baixo");
  assert.equal(byPath.get("src/orphan.txt").deletionDecision, "pode_apagar");
  assert.equal(byPath.get("src/orphan.txt").utilityStatus, "inutil_provavel");
  assert.equal(byPath.get("src/orphan.txt").relocationDecision, "pode_mexer");
  assert.equal(byPath.get("src/recent.tmp").deletionDecision, "inutil_provavel");
  assert.equal(byPath.get("src/recent.tmp").utilityStatus, "baixo_uso");
  assert.equal(byPath.get("package.json").classification, "critico_protegido");
  assert.equal(byPath.get("package.json").risk, "alto");
  assert.equal(byPath.get("package.json").deletionDecision, "nao_apagar");
  assert.ok(result.summary.entries >= result.summary.files + result.summary.directories);
  assert.ok(result.graphViews.far.nodes.length >= 1);
  assert.ok(result.graphViews.medium.nodes.length >= 1);
  assert.equal(result.graphViews.close.nodes.length, result.summary.files);
  assert.ok(result.simulation.decisionGroups.pode_apagar.length >= 1);
  assert.ok(result.simulation.decisionGroups.nao_apagar.length >= 1);
});

test("A.D.D resolve import Python relativo", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "src-add-py-"));
  await fs.mkdir(path.join(root, "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "pkg", "__init__.py"), "");
  await fs.writeFile(path.join(root, "pkg", "main.py"), "from .utils import work\nwork()\n");
  await fs.writeFile(path.join(root, "pkg", "utils.py"), "def work():\n    return 1\n");

  const result = await analyzeDirectory(root, {
    maxFiles: 100,
    maxDepth: 5
  });

  const edge = result.edges.find((item) => item.sourcePath === "pkg/main.py" && item.targetPath === "pkg/utils.py");
  assert.ok(edge, "esperava aresta Python relativa entre main.py e utils.py");
});
