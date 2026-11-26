/**
 * The splash closing before the main window exists must not quit MadY: on a slow start the
 * splash times out (or fails to load) first, and quitting then leaves the user with no window.
 */
import { describe, expect, it } from "vitest";
import { quitsWhenLastWindowCloses } from "./lastWindow";

describe("quitsWhenLastWindowCloses", () => {
  it("does not quit when the splash closes before the main window exists", () => {
    expect(quitsWhenLastWindowCloses("win32", false)).toBe(false);
    expect(quitsWhenLastWindowCloses("linux", false)).toBe(false);
  });

  it("quits when the last window closes after the main window was created", () => {
    expect(quitsWhenLastWindowCloses("win32", true)).toBe(true);
    expect(quitsWhenLastWindowCloses("linux", true)).toBe(true);
  });

  it("never quits on macOS, where the program stays in the dock", () => {
    expect(quitsWhenLastWindowCloses("darwin", true)).toBe(false);
    expect(quitsWhenLastWindowCloses("darwin", false)).toBe(false);
  });
});
