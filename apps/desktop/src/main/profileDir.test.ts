/**
 * A run's own profile folder (`profileDir.ts`), and that the program moves to it before anything
 * reads the profile: set too late, the log, the one-copy lock or the crash-recovery copy would
 * already be in the user's own folder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileDirOverride } from "./profileDir";

describe("profileDirOverride", () => {
  it("is the folder MADY_PROFILE_DIR names, and nothing when it is unset or blank", () => {
    // A full path on this system: a drive letter on Windows, a path from / elsewhere.
    const full = process.platform === "win32" ? "F:\\work\\test-profile" : "/work/test-profile";
    expect(profileDirOverride({ MADY_PROFILE_DIR: full })).toBe(full);
    expect(profileDirOverride({ MADY_PROFILE_DIR: "  /tmp/test-profile  " })).toBe("/tmp/test-profile");
    expect(profileDirOverride({})).toBeNull();
    expect(profileDirOverride({ MADY_PROFILE_DIR: "  " })).toBeNull();
  });

  it("refuses a relative folder rather than guess where it is", () => {
    expect(() => profileDirOverride({ MADY_PROFILE_DIR: "test-profile" })).toThrow(/absolute/);
  });
});

describe("the program moves to the folder before anything reads the profile", () => {
  const src = readFileSync(join(__dirname, "index.ts"), "utf8");
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    expect(i, `index.ts does not contain ${needle}`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("sets it before the log starts, before the one-copy lock, and before the first profile read", () => {
    const set = at('app.setPath("userData", profileDir)');
    expect(set).toBeLessThan(at("log.initialize()"));
    expect(set).toBeLessThan(at("requestSingleInstanceLock()"));
    expect(set).toBeLessThan(at('getPath("userData")'));
  });
});
