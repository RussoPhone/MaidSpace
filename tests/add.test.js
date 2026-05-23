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
  await fs.writeFile(path.join(root, "package.json"), "{\"scripts\":{\"start\":\"node src/app.js\"}}\n");

  const result = await analyzeDirectory(root, {
    maxFiles: 100,
    maxDepth: 5,
    maxFileSizeBytes: 128 * 1024
  });

  const byPath = new Map(result.nodes.map((node) => [node.relativePath, node]));

  assert.equal(result.summary.files, 5);
  assert.equal(result.summary.edges, 2);
  assert.equal(byPath.get("src/app.js").classification, "dependente");
  assert.equal(byPath.get("src/lib.js").classification, "provedor");
  assert.equal(byPath.get("src/style.css").classification, "provedor");
  assert.equal(byPath.get("src/orphan.txt").classification, "isolado");
  assert.equal(byPath.get("src/orphan.txt").risk, "baixo");
  assert.equal(byPath.get("package.json").classification, "critico_protegido");
  assert.equal(byPath.get("package.json").risk, "alto");
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
