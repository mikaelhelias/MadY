import { expect, it } from "vitest";
import { MADY_CORE_VERSION } from "./index";

it("exposes a version constant", () => {
  expect(MADY_CORE_VERSION).toBe("0.0.0");
});
