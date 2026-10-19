# Contributing to MadY

Thank you for helping improve MadY. Bug reports, suggestions and code changes are all welcome.

## Reporting a bug

The quickest way is from inside the program: **Help ▸ Report a bug…** gathers the MadY version,
the graph on screen and recent errors (with file paths removed, and your data only if you tick
it) and opens an e-mail ready to send, or saves it as a .zip.

You can also [open an issue](../../issues/new/choose) with the bug report form. Please include:

- the MadY version (**Help ▸ About MadY**) and your Windows version;
- the steps that lead to the problem, and what you expected instead;
- a small `.mady` file or data set that shows it, if you can share one.

Statistical results deserve particular care: if a number looks wrong, say which analysis, which
options, and what value you expected and from where.

Security problems are reported privately instead — see [SECURITY.md](SECURITY.md).

## Suggesting a feature

[Open an issue](../../issues/new/choose) with the feature request form. Describe what you are
trying to do and how you do it today; an example graph or analysis helps.

## Changing the code

Prerequisites: Node 24+, and Python 3 (`py -3` on Windows) with the statistics engine's packages:

```bash
py -3 -m pip install -r engines/py/requirements.txt -r engines/py/requirements-dev.txt
npm ci
```

Before opening a pull request, run the same checks as CI:

```bash
npx vitest run && npm run typecheck && npm run typecheck:tests && npm run lint
cd apps/desktop && npx tsc --noEmit && npx electron-vite build
```

- Run the app with `cd apps/desktop && npm run dev`; the end-to-end tests with `npm run e2e` from
  the repository root.
- Every new function comes with a test, and a test should be seen to fail without the change it
  guards.
- A new statistic needs an independent recomputation in `engines/py/crosscheck.py`, not one that
  shares code with the method it checks.
- Comments and test names describe what the program does and why.
- Building the Windows installer is described in [docs/BUILD-WINDOWS.md](docs/BUILD-WINDOWS.md).

In the pull request, say what changed and why, and how you tested it.

## Licence

MadY is licensed under the GNU General Public License, version 3 or later
([LICENSE](LICENSE)). By contributing, you agree that your contribution is licensed under the same
terms.
