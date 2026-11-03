/**
 * Every card in the New-graph dialog wears an icon that is its own. Without one, a graph genre
 * (Venn, Manhattan, Oncoprint, Treemap, …) falls through to the default three-bars icon and a
 * datasheet format (sets, timeline, meta, edge list, association, alterations) to a lone dot —
 * so the card is labelled by text alone, with a picture that says "bar chart" or nothing.
 * Default-deny: a new genre or
 * format must draw its own icon or this fails.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TABLE_FORMAT_ORDER } from "@mady/core";
import type { TableKind } from "@mady/core";
import { DataIcon } from "./dataIcons";
import { GraphIcon } from "./NewGraphDialog";
import { NEW_GRAPH_GENRES } from "./newGraph";

describe("New-graph dialog icons", () => {
  it("every graph genre draws its own icon, not the fallback", () => {
    const fallback = renderToStaticMarkup(<GraphIcon genre="__no_such_genre__" />);
    const generic = NEW_GRAPH_GENRES.filter((g) => renderToStaticMarkup(<GraphIcon genre={g.key} />) === fallback).map((g) => g.key);
    expect(generic, `genres wearing the fallback icon: ${generic.join(", ")}`).toEqual([]);
  });

  it("every datasheet format draws its own icon, not the fallback", () => {
    const fallback = renderToStaticMarkup(<DataIcon kind={"__no_such_kind__" as TableKind} />);
    const generic = TABLE_FORMAT_ORDER.filter((k) => renderToStaticMarkup(<DataIcon kind={k} />) === fallback);
    expect(generic, `formats wearing the fallback icon: ${generic.join(", ")}`).toEqual([]);
  });

  it("no two genres share one icon (an icon that means two graphs means neither)", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const g of NEW_GRAPH_GENRES) {
      const m = renderToStaticMarkup(<GraphIcon genre={g.key} />);
      const prev = seen.get(m);
      if (prev) clashes.push(`${prev} = ${g.key}`);
      else seen.set(m, g.key);
    }
    expect(clashes, `genres sharing an icon: ${clashes.join("; ")}`).toEqual([]);
  });
});
