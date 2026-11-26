// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ColorInput, eyeDropperSupported, pickScreenColor } from "./SchemaForm";

// A fake EyeDropper whose open() resolves to a chosen colour (or rejects to mimic
// the user pressing Escape). Installed on globalThis, removed after each test.
function installEyeDropper(behaviour: () => Promise<{ sRGBHex: string }>): void {
  (globalThis as unknown as { EyeDropper?: unknown }).EyeDropper = class {
    open(): Promise<{ sRGBHex: string }> {
      return behaviour();
    }
  };
}
function removeEyeDropper(): void {
  delete (globalThis as unknown as { EyeDropper?: unknown }).EyeDropper;
}

afterEach(() => {
  cleanup();
  removeEyeDropper();
  localStorage.clear();
});

describe("eyeDropperSupported", () => {
  it("is false with no EyeDropper on the runtime", () => {
    removeEyeDropper();
    expect(eyeDropperSupported()).toBe(false);
  });
  it("is true when the runtime provides an EyeDropper constructor", () => {
    installEyeDropper(() => Promise.resolve({ sRGBHex: "#123456" }));
    expect(eyeDropperSupported()).toBe(true);
  });
  it("is false when EyeDropper is present but not a constructor", () => {
    (globalThis as unknown as { EyeDropper?: unknown }).EyeDropper = "nope";
    expect(eyeDropperSupported()).toBe(false);
  });
});

describe("pickScreenColor", () => {
  it("returns the picked colour (lowercased) when the API resolves a hex", async () => {
    installEyeDropper(() => Promise.resolve({ sRGBHex: "#AB12CD" }));
    await expect(pickScreenColor()).resolves.toBe("#ab12cd");
  });
  it("returns undefined when the user cancels (open rejects — Escape/AbortError)", async () => {
    installEyeDropper(() => Promise.reject(new Error("AbortError")));
    await expect(pickScreenColor()).resolves.toBeUndefined();
  });
  it("returns undefined for a non-hex result", async () => {
    installEyeDropper(() => Promise.resolve({ sRGBHex: "rgb(1,2,3)" }));
    await expect(pickScreenColor()).resolves.toBeUndefined();
  });
  it("returns undefined when the API is absent", async () => {
    removeEyeDropper();
    await expect(pickScreenColor()).resolves.toBeUndefined();
  });
});

describe("ColorInput pipette button", () => {
  it("renders NO pipette button when EyeDropper is unsupported (never a dead button)", () => {
    removeEyeDropper();
    const { container } = render(<ColorInput value="#000000" onChange={() => {}} aria-label="X" />);
    expect(container.querySelector("input[type=color]")).toBeTruthy();
    expect(container.querySelector("button.pipette")).toBeNull();
  });

  it("renders the pipette when supported and applies the picked colour", async () => {
    installEyeDropper(() => Promise.resolve({ sRGBHex: "#0a0b0c" }));
    const onChange = vi.fn();
    const { container } = render(<ColorInput value="#000000" onChange={onChange} aria-label="X" />);
    const btn = container.querySelector("button.pipette") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    // the native input keeps its class/type so existing selectors still resolve it
    expect(container.querySelector("input.colorin, input[type=color]")).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("#0a0b0c"));
    // a cancelled pick must NOT fire onChange
    onChange.mockClear();
    removeEyeDropper();
    installEyeDropper(() => Promise.reject(new Error("AbortError")));
    fireEvent.click(container.querySelector("button.pipette") as HTMLButtonElement);
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
});
