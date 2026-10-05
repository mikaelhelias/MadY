/**
 * A double-clicked `.mady` file reaches MadY as a command-line argument. These are the
 * argument lists Windows and Electron really produce: the program comes first, development
 * adds the app folder, and a second copy's list carries Chromium's own switches.
 */
import { describe, expect, it } from "vitest";
import { projectPathFromArgv } from "./launchFile";

const MADY = ["mady"];

describe("projectPathFromArgv", () => {
  it("installed: MadY.exe followed by the double-clicked file", () => {
    const argv = ["C:\\Users\\me\\AppData\\Local\\Programs\\MadY\\MadY.exe", "C:\\data\\Assay 3.mady"];
    expect(projectPathFromArgv(argv, MADY)).toBe("C:\\data\\Assay 3.mady");
  });

  it("second copy: Chromium's switches come before the file and are never taken for it", () => {
    const argv = [
      "C:\\Programs\\MadY\\MadY.exe",
      "--allow-file-access-from-files",
      "--original-process-start-time=13370000000000000",
      "C:\\data\\run.mady",
    ];
    expect(projectPathFromArgv(argv, MADY)).toBe("C:\\data\\run.mady");
    // A switch whose VALUE happens to end in the extension is still a switch.
    expect(projectPathFromArgv(["MadY.exe", "--user-data-dir=C:\\tmp\\x.mady", "C:\\d\\y.mady"], MADY)).toBe("C:\\d\\y.mady");
  });

  it("development: the app folder is not a file", () => {
    expect(projectPathFromArgv(["electron.exe", ".", "F:\\p\\x.mady"], MADY)).toBe("F:\\p\\x.mady");
    expect(projectPathFromArgv(["electron.exe", "."], MADY)).toBeNull();
  });

  it("the program itself is never the file, even if its name ends in the extension", () => {
    expect(projectPathFromArgv(["C:\\odd\\tool.mady"], MADY)).toBeNull();
  });

  it("the extension is matched whatever its case", () => {
    expect(projectPathFromArgv(["MadY.exe", "C:\\DATA\\RUN.MADY"], MADY)).toBe("C:\\DATA\\RUN.MADY");
  });

  it("a plain launch, or a file of another kind, gives nothing", () => {
    expect(projectPathFromArgv(["MadY.exe"], MADY)).toBeNull();
    expect(projectPathFromArgv(["MadY.exe", "C:\\data\\table.csv"], MADY)).toBeNull();
    expect(projectPathFromArgv(["MadY.exe", "C:\\data\\mady"], MADY)).toBeNull();
  });
});
