/**
 * `optionEffects` values an option from its type's members (`stringUnions`). A type it cannot
 * resolve leaves its options "untestable": never measured, so never caught when they stop drawing.
 */
import { describe, expect, it } from "vitest";
import { SPECIAL_KINDS } from "@mady/core";
import { stringUnions } from "./optionEffects";

describe("stringUnions resolves the named types options are typed by", () => {
  it("a union written out as literals", () => {
    expect(stringUnions().get("SymbolFill")).toEqual(["solid", "open", "clear", "twotone"]);
  });

  it("a type derived from a list of names, (typeof LIST)[number]", () => {
    expect(stringUnions().get("SpecialKind")).toEqual([...SPECIAL_KINDS]);
  });
});
