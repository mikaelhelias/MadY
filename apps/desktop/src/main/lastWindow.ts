/**
 * Whether MadY quits when its last window closes.
 *
 * During startup the splash can be the only window: it closes itself after a time limit, or at
 * once if its page fails to load, and on a slow start (a busy disk, a scan of the program files)
 * both can happen before the main window exists. That close is not the user closing MadY, so it
 * must not quit the program — otherwise MadY exits without ever showing a window.
 * Once the main window exists, closing the last window quits, except on macOS, where the
 * program stays in the dock.
 */
export function quitsWhenLastWindowCloses(platform: string, mainWindowCreated: boolean): boolean {
  return mainWindowCreated && platform !== "darwin";
}
