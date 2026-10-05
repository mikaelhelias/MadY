# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the MadY stats engine.
#
# Produces a *onedir* bundle: dist/mady-engine/mady-engine.exe plus its
# private CPython + numpy/scipy/statsmodels. onedir (not onefile) is deliberate —
# a onefile build re-extracts scipy/statsmodels to a temp dir on *every* launch
# (slow cold-start + antivirus churn), which violates the sidecar's fast-start
# requirement. The whole bundle lives inside the app's resources dir, invisible
# to the user.
#
# Build:  py -3 -m PyInstaller mady-engine.spec --noconfirm
# Output: dist/mady-engine/  (referenced by electron-builder extraResources)

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# engine.py lazy-imports these inside handlers, so PyInstaller's static import
# graph misses them. collect_all pulls each package's submodules, data files and
# compiled extensions — robust against statsmodels' importlib-based dispatch.
#
# Their own test suites are left out (~2,000 modules and ~55 MB of test data): nothing
# outside a `tests` package imports one, and the engine never runs them.
def _not_a_test(name):
    return not any(part in ("tests", "conftest") for part in name.split("."))


for pkg in ("numpy", "scipy", "statsmodels", "pandas", "patsy"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg, filter_submodules=_not_a_test, exclude_datas=["**/tests/**"])
    datas += pkg_datas
    binaries += [b for b in pkg_binaries if _not_a_test(b[1].replace("\\", ".").replace("/", "."))]
    hiddenimports += pkg_hidden

a = Analysis(
    ["engine.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # GUI / notebook / test stacks the engine never touches — dropped to keep the
    # bundle lean. (statsmodels.graphics is collected above but only imported if
    # used; excluding matplotlib keeps those unused paths from bloating the build.)
    #
    # The second block is the big one: collect_all() on statsmodels/pandas follows
    # their optional integrations (arrow-backed dtypes, ML backends) into whatever
    # heavy libs happen to be installed in the build environment's site-packages —
    # torch, jaxlib, pyarrow, onnxruntime, sklearn, Pillow, etc., which can add over a
    # gigabyte. engine.py imports none of these (only numpy/scipy/statsmodels/pandas/patsy),
    # so they are excluded explicitly.
    excludes=[
        # GUI / notebook / test / docs
        "tkinter",
        "matplotlib",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "sphinx",
        "Pythonwin",
        "pywin",
        "win32com",
        # ML / array backends the engine never uses
        "torch",
        "jax",
        "jaxlib",
        "numpyro",
        "onnxruntime",
        "sklearn",
        "numba",
        "sympy",
        # optional pandas/arrow/db/image/crypto integrations
        "pyarrow",
        # xarray + its zarr storage stack. pandas has an optional xarray integration, so
        # collect_all("pandas") follows it whenever xarray is in site-packages — and other
        # Python packages pull it in (e.g. pingouin → pandas_flavor → xarray), adding ~12 MB
        # of code engine.py never imports. Excluded by name so other packages installed in
        # the build environment cannot change what ships.
        "xarray",
        "zarr",
        "numcodecs",
        "PIL",
        "Pillow",
        "lxml",
        "cryptography",
        "psycopg2",
        "psycopg2_binary",
        "sqlalchemy",
        "pydantic",
        "pydantic_core",
        "numpy_financial",
        "pandas_market_calendars",
        # Everything else a build environment's site-packages may offer that pandas/statsmodels/scipy only
        # reach through optional code paths engine.py never takes: web and async stacks, Excel
        # readers and writers, templating, test runners, packaging tools, Windows COM wrappers.
        # Named one by one so that a package installed later for some unrelated reason cannot
        # quietly ship inside the engine.
        "aiohttp", "aiodns", "aiohappyeyeballs", "aiosignal", "frozenlist", "multidict",
        "propcache", "yarl", "pycares", "tornado", "requests", "urllib3", "certifi",
        "charset_normalizer", "idna", "brotli", "fsspec", "bs4", "soupsieve",
        "openpyxl", "et_xmlfile", "xlrd", "xlsxwriter", "defusedxml",
        "jinja2", "markupsafe", "pygments", "yaml", "tqdm", "colorama", "platformdirs",
        "joblib", "mpmath", "cycler", "mpl_toolkits", "pylab",
        "_pytest", "pluggy", "iniconfig", "py",
        "setuptools", "pkg_resources", "_distutils_hack", "PyInstaller", "altgraph",
        "pefile", "ordlookup", "attr", "attrs", "cffi", "pycparser",
        "win32con", "win32ctypes", "win32evtlogutil", "winerror", "win32api", "pywintypes",
        "pythoncom", "win32pdh",  # numpy's test helpers only (memory use on Windows)
        # Standard-library parts that carry large DLLs (OpenSSL ~6 MB, SQLite ~1.7 MB): the engine
        # talks only over stdio and pandas imports sqlite3 only inside its SQL readers.
        "ssl", "_ssl", "_hashlib", "sqlite3", "_sqlite3",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="mady-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # no window; stdio is the transport
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="mady-engine",
)
