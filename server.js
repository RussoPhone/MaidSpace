const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeDirectory, DEFAULT_OPTIONS } = require("./src/add/analyzer");

const rootDirectory = __dirname;
const publicDirectory = path.join(rootDirectory, "public");
const port = readPort();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        cwd: rootDirectory,
        defaultOptions: DEFAULT_OPTIONS
      });
    }

    if (request.method === "POST" && request.url === "/api/scan") {
      const body = await readJsonBody(request);
      const result = await analyzeDirectory(body.rootPath || rootDirectory, body.options || {});
      return sendJson(response, 200, result);
    }

    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "Metodo nao suportado." });
    }

    return serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, {
      error: error.message || "Erro inesperado no servidor."
    });
  }
});

server.listen(port, () => {
  console.log(`S.R.C A.D.D rodando em http://localhost:${port}`);
});

function readPort() {
  const portArgIndex = process.argv.indexOf("--port");
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    return Number(process.argv[portArgIndex + 1]);
  }
  return Number(process.env.PORT || 4173);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const absolutePath = path.normalize(path.join(publicDirectory, requestedPath));
  const relativeToPublic = path.relative(publicDirectory, absolutePath);

  if (relativeToPublic.startsWith("..") || path.isAbsolute(relativeToPublic)) {
    return sendJson(response, 403, { error: "Caminho estatico invalido." });
  }

  try {
    const content = await fs.readFile(absolutePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(absolutePath),
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch (error) {
    sendJson(response, 404, { error: "Arquivo nao encontrado." });
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Corpo da requisicao muito grande."));
      }
    });
    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("JSON invalido."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[extension] || "application/octet-stream";
}
