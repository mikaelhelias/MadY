# Building the MadY Windows installer (one-click)

Two steps: freeze the statistics engine, then package and install. Produces a single
self-contained NSIS installer — the end user installs nothing but MadY (no Python, no
separate runtime).

## Prerequisites (dev machine only)
- Node 24 + npm (repo already set up: `npm install` at the root).
- **Python 3.14 (`py -3`)** with the engine's runtime libs + PyInstaller:
  ```
  py -3 -m pip install -r engines/py/requirements.txt
  ```
  (numpy, scipy, statsmodels, pandas, patsy + pyinstaller — pinned there.)

## One-shot build
From `apps/desktop/`:
```
export ELECTRON_BUILDER_CACHE="$(cd ../.. && pwd)/node_modules/.cache/electron-builder"
npm run freeze-engine     # PyInstaller → engines/py/dist/mady-engine/   (~2 min, ~200 MB)
npm run dist              # electron-vite build + electron-builder NSIS → apps/desktop/release/
```
**The `ELECTRON_BUILDER_CACHE` line is not optional where the user profile is encrypted** — without it the build
dies before NSIS ever runs and you get a .zip but no Setup .exe. Why: see "EXDEV" below.
Output: **`apps/desktop/release/MadY Setup <version>.exe`** (~220 MB).
Double-click it → per-user one-click install (no UAC), desktop + Start-menu shortcuts.

`npm run dist:dir` skips the installer and just produces `release/win-unpacked/` (a
runnable `MadY.exe`) — faster for iteration.

## How the pieces fit
- **Frozen engine** — `engines/py/mady-engine.spec` (onedir, not onefile, so
  scipy/statsmodels aren't re-extracted to temp on every launch). `collect_all`
  pulls numpy/scipy/statsmodels/pandas/patsy (they're lazy-imported in engine.py,
  invisible to PyInstaller's static analysis). A big `excludes` list drops torch /
  jax / pyarrow / sklearn / Pillow etc. that `collect_all` would otherwise sweep in
  from a data-science Python's site-packages; the frozen engine is about 200 MB.
- **Bundling** — `apps/desktop/electron-builder.yml` ships the frozen engine as
  `extraResources` → `resources/engine/` (outside the asar; a native binary can't
  run from inside an archive).
- **Runtime path** — `resolveEngine()` in `src/main/index.ts`: when `app.isPackaged`
  it spawns `process.resourcesPath/engine/mady-engine.exe`; in dev it still uses
  system `py -3 engine.py`.
- `electronVersion` is pinned in the yml because electron is hoisted to the
  monorepo-root `node_modules` and electron-builder can't discover it from
  `apps/desktop/node_modules`.

## Verifying the freeze standalone (no Electron)
```
py -3 engines/py/roundtrip_test.py <abs-path-to>/mady-engine.exe
```
Exercises the framed-JSON protocol: hello handshake, ping, describe (numpy+scipy),
regression (statsmodels). Exit 0 = the heavy libs are bundled and importable.

## Known gotchas
- **EXDEV — "cross-device link not permitted"** while extracting the 7zip or NSIS
  toolchain. The cause, on a machine where `C:\Users\<user>\AppData\Local` carries the
  Windows **EFS `Encrypted` attribute** (check with
  `Get-Item -Force <path> | Select Attributes` → `Directory, Archive, Encrypted`):
  electron-builder unpacks each toolchain into `<dir>.tmp` and then **renames** it into place,
  and Windows refuses to rename a directory across an encryption boundary — it returns
  `ERROR_NOT_SAME_DEVICE`, which Node reports as `EXDEV`.
  - **The tell:** the build reaches `building target=zip`, then dies. You get
    `MadY-<version>-win.zip` and **never** a `MadY Setup <version>.exe`, and the cache is left
    holding un-renamed `*.tmp` directories.
  - **Fix:** point the cache anywhere unencrypted —
    `ELECTRON_BUILDER_CACHE='<MadY folder>\node_modules\.cache\electron-builder'`
    (inside the repository, gitignored by the blanket `node_modules/` rule).
  - Other folders under `AppData\Local` (such as `npm-cache` and `Temp`) may not carry the
    attribute, so other tools can work normally while this build fails.
- **`npm run dist` rewrites `apps/desktop/package.json`**: electron-builder's asar transform
  strips `scripts` and `devDependencies` from the source file on every build. Restore it
  afterwards with `git checkout HEAD -- apps/desktop/package.json` before committing.
- **SmartScreen** — the installer is **unsigned**, so Windows shows a
  "Windows protected your PC" warning on first run (More info → Run anyway). Code
  signing takes an OV/EV certificate, set through `win.certificateFile`.
- Rebuild the frozen engine (`npm run freeze-engine`) whenever `engine.py` or its
  Python deps change — `npm run dist` does **not** re-freeze it.
