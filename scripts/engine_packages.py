"""What the frozen statistics engine ships, as Python distributions.

Read from the frozen bundle itself: the folders, modules and compiled extensions in `_internal`,
the `*.dist-info` folders PyInstaller kept there, and the module archive inside `mady-engine.exe`
(pure-Python packages live only there, so a listing of `_internal` alone misses them). Each
top-level name is mapped to the distribution installed in this Python, the one that froze the
engine. The standard library is not a distribution and is left out.

    py -3 scripts/engine_packages.py <engine folder>

prints JSON: {"distributions": [{"name", "module", "dist_info"}], "unclaimed": [names]}.
"unclaimed" are shipped modules that no installed distribution declares: their licence is unknown.
Used by gen-third-party-notices.mjs to list them.
"""
import importlib.metadata as md
import json
import os
import sys

# Folders PyInstaller copies under a name the distribution does not declare.
RENAMED = {n: "pywin32" for n in ("win32", "pywin32_system32", "win32com", "pythonwin", "win32con", "win32evtlogutil", "winerror")}


def top_level_names(internal_entries, internal_dirs, archive_modules, stdlib):
    """Importable top-level names in the bundle, standard library excluded: folders, `.py` and
    `.pyd` files in `_internal`, and the modules of the archive inside the executable."""
    names = set()
    for e in internal_entries:
        if e.endswith((".dist-info", ".libs")) or e.startswith("."):
            continue
        if e in internal_dirs or e.endswith((".py", ".pyd")):
            names.add(e.split(".")[0])
    names |= {m.split(".")[0] for m in archive_modules}
    return sorted(n for n in names if n not in stdlib)


def distributions(names, pkg2dist, kept_dist_infos):
    """The distributions behind `names`, each once, with the first module that brought it; then
    every distribution whose metadata the bundle kept even without a module of its own name
    (tqdm keeps its dist-info while its module goes by another name). Names no distribution
    declares come back separately."""
    out, seen, unclaimed = [], set(), []
    for n in names:
        dists = pkg2dist.get(n) or ([RENAMED[n]] if n in RENAMED else [])
        if not dists:
            unclaimed.append(n)
        for d in dists:
            if d.lower() not in seen:
                seen.add(d.lower())
                out.append({"name": d, "module": n, "dist_info": kept_dist_infos.get(d.lower())})
    for key, path in sorted(kept_dist_infos.items()):
        if key not in seen:
            seen.add(key)
            out.append({"name": md.Distribution.at(path).metadata["Name"], "module": None, "dist_info": path})
    return out, unclaimed


def shipped(engine_dir):
    internal = os.path.join(engine_dir, "_internal")
    # The engine program as built: mady-engine.exe on Windows, mady-engine on macOS (whichever is there,
    # so a build can be read on another system).
    exe = os.path.join(engine_dir, "mady-engine.exe")
    if not os.path.exists(exe):
        exe = os.path.join(engine_dir, "mady-engine")
    entries = os.listdir(internal)
    dirs = {e for e in entries if os.path.isdir(os.path.join(internal, e))}
    from PyInstaller.archive.readers import CArchiveReader

    archive = list(CArchiveReader(exe).open_embedded_archive("PYZ.pyz").toc.keys())
    kept = {}
    for e in entries:
        if e.endswith(".dist-info"):
            path = os.path.join(internal, e)
            kept[md.Distribution.at(path).metadata["Name"].lower()] = path
    names = top_level_names(entries, dirs, archive, set(sys.stdlib_module_names))
    found, unclaimed = distributions(names, md.packages_distributions(), kept)
    return {"distributions": found, "unclaimed": unclaimed}


if __name__ == "__main__":
    print(json.dumps(shipped(sys.argv[1])))
