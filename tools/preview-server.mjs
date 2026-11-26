/**
 * Dev-only static file server for previewing the built renderer
 * (apps/desktop/out/renderer) in a plain browser — lets us screenshot the React
 * shell without launching Electron. `window.mady` (the Electron preload bridge)
 * is absent in a browser, so the Analyze button is inert here; everything else
 * (project tree, tabs, graph renderer) is pure React and renders normally.
 * Usage: node tools/preview-server.mjs <root-dir> <port>
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.argv[2] ?? "apps/desktop/out/renderer";
const PORT = Number(process.argv[3] ?? 8849);
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  // The manual's videos, served as video rather than as an anonymous download.
  ".webm": "video/webm",
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    const file = normalize(join(ROOT, rel));
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`preview serving ${ROOT} on http://127.0.0.1:${PORT}`));
