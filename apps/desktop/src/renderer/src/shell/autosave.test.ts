// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSampleDocument } from "@mady/core";
import { AUTOSAVE_DEBOUNCE_MS, buildSnapshot, formatAge, projectName, resolveAutosave } from "./autosave";

const sample = () => createSampleDocument().toJSON();

describe("buildSnapshot", () => {
  it("wraps the serialized project in a v1 envelope that round-trips", () => {
    const project = sample();
    const snap = buildSnapshot("My project", project, 12345);
    expect(snap.v).toBe(1);
    expect(snap.savedAt).toBe(12345);
    expect(snap.name).toBe("My project");
    expect(JSON.parse(snap.json)).toEqual(project);
  });
});

describe("projectName", () => {
  it("uses the first project folder, else a fallback", () => {
    const project = sample();
    expect(projectName(project)).toBe(project.workspace.folders[0]!.name);
    expect(projectName({ ...project, workspace: { ...project.workspace, folders: [] } })).toBe(
      "Untitled project",
    );
  });
});

describe("formatAge", () => {
  it("buckets the age and pluralizes", () => {
    expect(formatAge(5_000)).toBe("less than a minute ago");
    expect(formatAge(60_000)).toBe("1 minute ago");
    expect(formatAge(5 * 60_000)).toBe("5 minutes ago");
    expect(formatAge(60 * 60_000)).toBe("1 hour ago");
    expect(formatAge(3 * 60 * 60_000)).toBe("3 hours ago");
    expect(formatAge(24 * 60 * 60_000)).toBe("1 day ago");
    expect(formatAge(50 * 60 * 60_000)).toBe("2 days ago");
  });

  it("treats negative / non-finite ages as just-saved", () => {
    expect(formatAge(-1)).toBe("less than a minute ago");
    expect(formatAge(NaN)).toBe("less than a minute ago");
  });
});

describe("AUTOSAVE_DEBOUNCE_MS", () => {
  it("is a positive debounce of at most 5 seconds", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThanOrEqual(5000);
  });
});

describe("resolveAutosave", () => {
  it("empty defaults ⇒ enabled at the built-in debounce", () => {
    expect(resolveAutosave({})).toEqual({ enabled: true, ms: AUTOSAVE_DEBOUNCE_MS });
  });

  it("honours a saved interval + explicit disable", () => {
    expect(resolveAutosave({ autosaveMs: 5000, autosaveEnabled: true })).toEqual({ enabled: true, ms: 5000 });
    expect(resolveAutosave({ autosaveEnabled: false })).toEqual({ enabled: false, ms: AUTOSAVE_DEBOUNCE_MS });
  });

  it("falls back to the built-in debounce for a non-positive / non-finite interval", () => {
    expect(resolveAutosave({ autosaveMs: 0 }).ms).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(resolveAutosave({ autosaveMs: -100 }).ms).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(resolveAutosave({ autosaveMs: NaN }).ms).toBe(AUTOSAVE_DEBOUNCE_MS);
  });
});
