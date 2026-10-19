// Shared Node persistence for desktop and MCP.
import { copyFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
let tmpCounter = 0;
const TRANSIENT_RENAME_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inFlight = /* @__PURE__ */ new Map();
async function renameWithRetry(tmp, path) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      const code = error?.code;
      if (!code || code === "EXDEV" || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      if (attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
      await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
async function writeOnce(path, data, allowCopyFallback) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  try {
    await writeFile(tmp, data, "utf8");
    await renameWithRetry(tmp, path);
  } catch (error) {
    // Preserve the desktop's redirected-volume fallback only when requested.
    // MCP saves require atomic replacement even if that means reporting failure.
    if (allowCopyFallback && error?.code === "EXDEV") {
      try { await copyFile(tmp, path); }
      finally { await unlink(tmp).catch(() => {}); }
      return;
    }
    await unlink(tmp).catch(() => {
    });
    throw error;
  }
}
async function atomicWrite(path, data, { allowCopyFallback = true } = {}) {
  path = resolve(path);
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  const previous = inFlight.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {
  }).then(() => writeOnce(path, data, allowCopyFallback));
  inFlight.set(key, run);
  try {
    await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }
}
export {
  atomicWrite
};
