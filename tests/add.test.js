const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeDirectory } = require("../src/add/analyzer");
const { runSrcPipeline } = require("../server");

test("A.D.D classifica dicente, docente, isolado e protegido", async () => {
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
  assert.equal(byPath.get("src/app.js").classification, "dicente");
  assert.equal(byPath.get("src/lib.js").classification, "docente");
  assert.equal(byPath.get("src/lib.js").impactCount, 1);
  assert.equal(byPath.get("src/lib.js").deletionDecision, "averiguar");
  assert.equal(byPath.get("src/style.css").classification, "docente");
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

test("A.D.D detecta ciclo por DFS e marca bloco interdependente", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "src-add-cycle-"));
  await fs.writeFile(path.join(root, "a.js"), "import './b.js';\n");
  await fs.writeFile(path.join(root, "b.js"), "import './c.js';\n");
  await fs.writeFile(path.join(root, "c.js"), "import './a.js';\n");

  const result = await analyzeDirectory(root, {
    maxFiles: 100,
    maxDepth: 2
  });
  const byPath = new Map(result.nodes.map((node) => [node.relativePath, node]));

  assert.equal(result.cycles.length, 1);
  assert.equal(result.summary.cycles, 1);
  assert.equal(byPath.get("a.js").inCycle, true);
  assert.equal(byPath.get("a.js").risk, "critico");
  assert.equal(byPath.get("a.js").deletionDecision, "nao_apagar");
  assert.ok(byPath.get("a.js").simulation.moveRequires.includes("b.js"));
});

test("S.R.C gera plano A.R.E e estado A.L.C sem mover arquivos", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "src-pipeline-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "main.js"), "import './dep.js';\n");
  await fs.writeFile(path.join(root, "src", "dep.js"), "export const dep = true;\n");
  await fs.writeFile(path.join(root, "notes.txt"), "rascunho antigo\n");
  const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(root, "notes.txt"), oldDate, oldDate);

  const result = await runSrcPipeline(root, {
    maxFiles: 100,
    maxDepth: 4,
    saveState: false
  });

  assert.equal(result.system, "S.R.C");
  assert.equal(result.modules.add.status, "concluido");
  assert.equal(result.modules.are.status, "plano_gerado");
  assert.equal(result.modules.alc.status, "estado_nao_salvo");
  assert.ok(result.relocationPlan.operations.some((item) => item.source === "notes.txt"));
  assert.equal(result.continuousState.mode, "primeiro_estado");
  assert.match(result.report.text, /A\.D\.D/);
});

test("A.R.E calcula espaco realocavel por modo e arquivos bloqueados", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "src-are-space-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "old.tmp"), Buffer.alloc(4096));
  await fs.writeFile(path.join(root, "recent.txt"), Buffer.alloc(2048));
  await fs.writeFile(path.join(root, "src", "main.js"), "import './dep.js';\n");
  await fs.writeFile(path.join(root, "src", "dep.js"), "export const dep = true;\n");
  const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(root, "old.tmp"), oldDate, oldDate);
  await fs.utimes(path.join(root, "src", "main.js"), oldDate, oldDate);
  await fs.utimes(path.join(root, "src", "dep.js"), oldDate, oldDate);

  const result = await runSrcPipeline(root, {
    maxFiles: 100,
    maxDepth: 4,
    saveState: false
  });
  const plan = result.relocationPlan;

  assert.ok(plan.spaceModes.baixo.reallocatableBytes >= 4096);
  assert.ok(plan.spaceModes.medio.reallocatableBytes >= plan.spaceModes.baixo.reallocatableBytes);
  assert.ok(plan.spaceModes.alto.reallocatableBytes >= plan.spaceModes.medio.reallocatableBytes);
  assert.ok(plan.candidatesByMode.baixo.some((item) => item.path === "old.tmp"));
  assert.ok(plan.candidatesByMode.medio.some((item) => item.path === "src/main.js" && item.packagePaths.includes("src/dep.js")));
  assert.ok(plan.spaceModes.medio.packages.some((item) => item.files.includes("src/main.js") && item.files.includes("src/dep.js")));
  assert.equal(plan.relocationSimulation.medio.beforeBytes, plan.summary.totalBytes);
  assert.equal(
    plan.relocationSimulation.medio.remainingBytes,
    plan.summary.totalBytes - plan.relocationSimulation.medio.relocatedBytes
  );
  assert.ok(plan.relocationSimulation.medio.simulatedMoves.some((item) => item.files.includes("src/dep.js")));
  assert.ok(plan.blockedFiles.some((item) => item.path === "recent.txt"));
  assert.match(plan.safetyReport.text, /Modo baixo/);
});
