/**
 * Write THIRD-PARTY-NOTICES.md from what a BUILT MadY actually ships — not from package.json, which
 * lists what the source asks for rather than what ends up in the installer.
 *
 * Run from the repo root after a build:
 *   node scripts/gen-third-party-notices.mjs [path/to/win-unpacked]
 *   (default: apps/desktop/release/win-unpacked)
 *
 * Three parts, each read from the package:
 *   • the app — every package under `resources/app.asar/node_modules` (MadY's own excluded): its
 *     name, version and licence from its own package.json, its licence text from its own
 *     LICENSE / LICENCE / COPYING file;
 *   • the statistics engine — every Python distribution frozen into `resources/engine/_internal`:
 *     from the bundle's own `*.dist-info` where PyInstaller kept one, otherwise from the same
 *     distribution installed in the Python that froze it (`py -3`), with a warning if the versions
 *     differ;
 *   • the runtimes — Electron / Chromium (their own licence files ship beside MadY.exe), Python,
 *     and the libraries the frozen engine carries.
 * Licences that are not plainly permissive are listed at the end of the run for a person to read.
 * No network, no new package: only files already on disk.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNPACKED = process.argv[2] ?? join(ROOT, "apps/desktop/release/win-unpacked");
const ASAR = join(UNPACKED, "resources/app.asar");
const ENGINE = join(UNPACKED, "resources/engine/_internal");
for (const p of [ASAR, ENGINE]) if (!existsSync(p)) { console.error(`gen-third-party-notices: ${p} not found — build first, or pass the win-unpacked folder`); process.exit(1); }
const OUT = join(ROOT, "THIRD-PARTY-NOTICES.md");
const PERMISSIVE = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Python-2\.0|PSF-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Zlib|MIT-0)$/i;
const review = [];

/** The standard texts, for a package that declares one of these licences but ships no text of it.
 *  The copyright line is the package's own author, from its package.json. */
const STANDARD = {
  MIT: (who) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (who) => `ISC License\n\nCopyright (c) ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
};
const standardFor = (lic) => (/^(MIT|MIT\/X11|X11)$/i.test(lic) ? "MIT" : /^ISC$/i.test(lic) ? "ISC" : null);

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-.](md|markdown|txt|rst|mit|bsd|apache))?$/i;
const licenceTexts = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile()).sort().map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim()) : [];

// ── the app: node_modules inside app.asar ──────────────────────────────────────────────────────
const TMP = mkdtempSync(join(ROOT, "node_modules", ".notices-"));
const js = [];
try {
  execFileSync(process.execPath, [join(ROOT, "node_modules/@electron/asar/bin/asar.js"), "extract", ASAR, TMP]);
  const NM = join(TMP, "node_modules");
  const dirs = [];
  for (const e of readdirSync(NM)) {
    if (e.startsWith(".")) continue;
    if (e.startsWith("@")) { if (e === "@mady") continue; for (const s of readdirSync(join(NM, e))) dirs.push(join(e, s)); }
    else dirs.push(e);
  }
  for (const d of dirs.sort()) {
    const pj = join(NM, d, "package.json");
    if (!existsSync(pj)) continue;
    const j = JSON.parse(readFileSync(pj, "utf8"));
    const lic = typeof j.license === "string" ? j.license : j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type ?? l).join(" OR ") : "UNKNOWN");
    let texts = licenceTexts(join(NM, d));
    // No licence file: the README's own licence section, when it has one (older packages put it there).
    if (!texts.length) {
      const readme = readdirSync(join(NM, d)).find((f) => /^readme(\.(md|markdown|txt))?$/i.test(f));
      const lines = readme ? readFileSync(join(NM, d, readme), "utf8").split(/\r?\n/) : [];
      const at = lines.findIndex((l) => /^#*\s*licen[cs]e\s*$/i.test(l.trim()));
      if (at >= 0) {
        const body = [];
        for (let i = at + 1; i < lines.length; i++) {
          const l = lines[i];
          if (i === at + 1 && /^[=-]{3,}\s*$/.test(l)) continue; // the heading's underline
          if (/^#+\s/.test(l) || (i + 1 < lines.length && /^[=-]{3,}\s*$/.test(lines[i + 1]) && l.trim())) break; // next heading
          body.push(l);
        }
        const text = body.join("\n").trim();
        if (text) texts = [`(from the package's README)\n${text}`];
      }
    }
    const author = typeof j.author === "string" ? j.author : j.author?.name;
    if (!texts.length && standardFor(lic) && author) {
      texts = [`(the package ships no licence text; the standard ${standardFor(lic)} text, under the author its package.json names)\n\n${STANDARD[standardFor(lic)](author)}`];
    }
    js.push({ name: j.name ?? d.replace(/\\/g, "/"), version: j.version ?? "?", licence: lic, texts, author });
    if (!lic.split(/\s+(?:OR|AND)\s+|[()]/).filter(Boolean).every((x) => PERMISSIVE.test(x.trim()))) review.push(`app      ${j.name}@${j.version}: ${lic}`);
    if (!texts.length) review.push(`app      ${j.name}@${j.version}: no licence file in the package (notice built from package.json only)`);
    if (lic === "UNKNOWN") js[js.length - 1].licence = "None stated — the package declares no licence";
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// ── the engine: Python distributions frozen into _internal ─────────────────────────────────────
const py = JSON.parse(
  execFileSync("py", ["-3", "-c", `
import json, os, sys, importlib.metadata as md
sys.path.insert(0, sys.argv[2])
import engine_packages
found = engine_packages.shipped(os.path.dirname(sys.argv[1]))
if found['unclaimed']: print('UNCLAIMED ' + ' '.join(found['unclaimed']), file=sys.stderr)
bundled = {d['name'].lower(): (d['dist_info'], os.path.basename(d['dist_info'])[:-10].rsplit('-', 1)[1]) for d in found['distributions'] if d['dist_info']}
seen, out = set(), []
todo = [(d['module'], d['name']) for d in found['distributions']]
for module, dist in todo:
    key = dist.lower()
    if key in seen: continue
    seen.add(key)
    where, bver = bundled.get(key, (None, None))
    d = md.Distribution.at(where) if where else md.distribution(dist)
    m = d.metadata
    lic = m.get('License-Expression') or ''
    if not lic:
        cls = [c.split('::')[-1].strip() for c in (m.get_all('Classifier') or []) if c.startswith('License ::')]
        raw = (m.get('License') or '').strip()
        lic = '; '.join(cls) if cls else (raw.splitlines()[0][:80] if raw else 'UNKNOWN')
    texts = []
    for f in (d.files or []):
        base = os.path.basename(str(f)).lower()
        if base.startswith(('license', 'licence', 'copying', 'notice')) and ('dist-info' in str(f) or '/' not in str(f).replace(os.sep, '/').rstrip('/')):
            try: texts.append(open(d.locate_file(f), encoding='utf-8', errors='replace').read().replace('\\r\\n', '\\n').strip())
            except OSError: pass
    if not texts:
        # One folder down (pywin32 keeps win32/license.txt and friends); identical copies once.
        for f in (d.files or []):
            parts = str(f).replace(os.sep, '/').split('/')
            if len(parts) == 2 and parts[1].lower().startswith(('license', 'licence', 'copying')):
                try:
                    text = open(d.locate_file(f), encoding='utf-8', errors='replace').read().replace('\\r\\n', '\\n').strip()
                    if text not in texts: texts.append(text)
                except OSError: pass
    if not texts and where:
        for f in sorted(os.listdir(where)):
            if f.lower().startswith(('license', 'licence', 'copying')): texts.append(open(os.path.join(where, f), encoding='utf-8', errors='replace').read().strip())
        lic_dir = os.path.join(where, 'licenses')
        if os.path.isdir(lic_dir):
            for r, _, fs in os.walk(lic_dir):
                for f in sorted(fs): texts.append(open(os.path.join(r, f), encoding='utf-8', errors='replace').read().strip())
    out.append({'name': m['Name'], 'version': m['Version'], 'bundled_version': bver, 'from_bundle': bool(where), 'licence': lic, 'texts': texts, 'module': module})
print(json.dumps(out))
`, ENGINE, join(ROOT, "scripts")], { encoding: "utf8", maxBuffer: 1e9 }),
);
for (const p of py) {
  if (p.bundled_version && p.bundled_version !== p.version) review.push(`engine   ${p.name}: bundle ${p.bundled_version}, metadata ${p.version}`);
  if (!p.from_bundle) p.note = "licence read from the same package installed in the freezing Python";
  const ok = /MIT|BSD|Apache|PSF|Python Software|ISC|Public Domain|Unlicense|MPL-2|Mozilla Public License 2/i.test(p.licence);
  if (!ok || /GPL/i.test(p.licence)) review.push(`engine   ${p.name}@${p.version}: ${p.licence}`);
  if (!p.texts.length) review.push(`engine   ${p.name}@${p.version}: no licence text found`);
}

// ── the runtimes ────────────────────────────────────────────────────────────────────────────────
const pyVersion = execFileSync("py", ["-3", "-c", "import platform; print(platform.python_version())"], { encoding: "utf8" }).trim();
const runtimeFiles = readdirSync(ENGINE);
const RUNTIMES = [
  ["Electron", "MIT", "`LICENSE.electron.txt`, shipped beside `MadY.exe`"],
  ["Chromium (inside Electron) and its components", "BSD-3-Clause and others", "`LICENSES.chromium.html`, shipped beside `MadY.exe`"],
  [`Python ${pyVersion} (\`python3*.dll\`, the standard library)`, "PSF-2.0", "https://docs.python.org/3/license.html"],
  ...(runtimeFiles.some((f) => /^libcrypto|^libssl/i.test(f)) ? [["OpenSSL (`libcrypto`, `libssl`, used by Python)", "Apache-2.0", "https://www.openssl.org/source/license.html"]] : []),
  ...(runtimeFiles.some((f) => /^libffi/i.test(f)) ? [["libffi (used by Python)", "MIT", "https://github.com/libffi/libffi/blob/master/LICENSE"]] : []),
  ...(runtimeFiles.some((f) => /^sqlite3/i.test(f)) ? [["SQLite (used by Python)", "Public domain", "https://www.sqlite.org/copyright.html"]] : []),
  ...(runtimeFiles.some((f) => /^VCRUNTIME/i.test(f)) ? [["Microsoft Visual C++ runtime (`VCRUNTIME140*.dll`)", "Microsoft redistributable licence", "distributed under the Visual Studio redistribution terms"]] : []),
  ["PyInstaller bootloader (starts the frozen engine)", "GPL-2.0-or-later with the PyInstaller bootloader exception", "the exception allows distributing it with programs of any licence: https://pyinstaller.org/en/stable/license.html"],
];

// ── the file ────────────────────────────────────────────────────────────────────────────────────
const version = JSON.parse(readFileSync(join(ROOT, "apps/desktop/package.json"), "utf8")).version;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
const L = [];
L.push("# Third-Party Notices", "");
L.push(`MadY ${version} includes the third-party software listed here. Each part keeps its own licence;`);
L.push("the copyright notices and licence texts follow the tables, as the licences require. MadY itself");
L.push("is GPL-3.0-or-later (see `LICENSE`).", "");
L.push("GENERATED by `scripts/gen-third-party-notices.mjs` from the built package — do not edit by hand;", "re-run it after any dependency change.", "");
L.push("## Runtimes", "", "| Component | Licence | Licence text |", "|---|---|---|");
for (const [c, l, w] of RUNTIMES) L.push(`| ${c} | ${l} | ${w} |`);
L.push("", `## The app — ${js.length} JavaScript packages`, "", "| Package | Version | Licence |", "|---|---|---|");
for (const p of js) L.push(`| ${esc(p.name)} | ${esc(p.version)} | ${esc(p.licence)} |`);
L.push("", `## The statistics engine — ${py.length} Python packages`, "", "| Package | Version | Licence |", "|---|---|---|");
for (const p of py) L.push(`| ${esc(p.name)} | ${esc(p.version)} | ${esc(p.licence)}${p.note ? " ¹" : ""} |`);
if (py.some((p) => p.note)) L.push("", "¹ The frozen bundle keeps no metadata for this package; its licence was read from the same package installed in the Python that froze the engine.");
L.push("", "## Licence texts", "");
L.push("Packages whose licence text is word-for-word the same are listed together above the one text.", "");
const groups = new Map();
for (const p of [...js.map((p) => ({ ...p, part: "app" })), ...py.map((p) => ({ ...p, part: "engine" }))]) {
  const text = p.texts.length ? p.texts.join("\n\n-----\n\n") : `${p.licence}${p.author ? ` — ${p.author}` : ""} (no licence file ships with this package)`;
  if (!groups.has(text)) groups.set(text, []);
  groups.get(text).push(`${p.name} ${p.version}`);
}
for (const [text, names] of groups) {
  L.push(`### ${names.join(", ")}`, "", "```", text.replace(/```/g, "'''"), "```", "");
}
writeFileSync(OUT, L.join("\n") + "\n", "utf8");
console.log(`THIRD-PARTY-NOTICES.md: ${js.length} app packages, ${py.length} engine packages, ${RUNTIMES.length} runtimes, ${groups.size} licence texts (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
if (review.length) console.log(`\nfor a person to read (${review.length}):\n  ${review.join("\n  ")}`);
