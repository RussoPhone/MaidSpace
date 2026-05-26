const { spawn } = require("node:child_process");
const { startServer } = require("../../server");

async function main() {
  const { url } = await startServer({ port: 0, host: "127.0.0.1" });
  openLocalWindow(url);
  console.log("Janela local aberta. Feche este terminal para encerrar o S.R.C A.D.D.");
}

function openLocalWindow(url) {
  if (process.platform === "win32") {
    const edgeArgs = ["-NoProfile", "-Command", `Start-Process msedge -ArgumentList '--app=${url}'`];
    const edge = spawn("powershell.exe", edgeArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    edge.on("error", () => openDefaultBrowser(url));
    edge.unref();
    return;
  }

  openDefaultBrowser(url);
}

function openDefaultBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
