import type { ReactElement } from "react";
import type { TableKind } from "@mady/core";

/**
 * A small inline schematic icon per data-table format (`TableKind`) — the visual
 * anchor for the data-type cards shared by the Analyze dialog and the New-graph
 * dialog. 36×32 viewBox, `currentColor` strokes so it inherits the surrounding text
 * colour (accent when highlighted).
 */
export function DataIcon({ kind }: { kind: TableKind }): ReactElement {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const dot = (cx: number, cy: number) => <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r={1.7} fill="currentColor" stroke="none" />;
  let body: ReactElement;
  switch (kind) {
    case "xy": // scatter + trend line
      body = <>{<line x1={4} y1={24} x2={32} y2={6} {...p} />}{dot(8, 20)}{dot(15, 16)}{dot(22, 11)}{dot(28, 8)}</>;
      break;
    case "column": // vertical bars
      body = <>{([ [6, 14], [14, 8], [22, 18], [30, 5] ] as Array<[number, number]>).map(([x, y], i) => <rect key={i} x={x - 3} y={y} width={6} height={26 - y} rx={1} {...p} />)}</>;
      break;
    case "grouped": // clustered bar pairs
      body = <>{[ [6, 12, "currentColor"], [12, 6, "var(--accent)"], [22, 16, "currentColor"], [28, 10, "var(--accent)"] ].map(([x, y, f], i) => <rect key={i} x={(x as number) - 2.6} y={y as number} width={5.2} height={26 - (y as number)} rx={1} fill={f as string} opacity={0.85} />)}</>;
      break;
    case "contingency": // 2×2 grid
      body = <><rect x={7} y={5} width={22} height={22} rx={2} {...p} /><line x1={18} y1={5} x2={18} y2={27} {...p} /><line x1={7} y1={16} x2={29} y2={16} {...p} /></>;
      break;
    case "survival": // descending staircase
      body = <polyline points="4,6 12,6 12,13 20,13 20,20 28,20 28,26 33,26" {...p} />;
      break;
    case "partsofwhole": // pie with a wedge
      body = <><circle cx={18} cy={16} r={11} {...p} /><path d="M18 16 L18 5 A11 11 0 0 1 28 13 Z" fill="var(--accent)" stroke="none" opacity={0.8} /><line x1={18} y1={16} x2={18} y2={5} {...p} /><line x1={18} y1={16} x2={28} y2={13} {...p} /></>;
      break;
    case "multivariable": // 3×3 dot matrix
      body = <>{[8, 18, 28].flatMap((x) => [7, 16, 25].map((y) => dot(x, y)))}</>;
      break;
    case "pca": // ordination cloud: scattered points around crossed component axes
      body = <><line x1={4} y1={16} x2={32} y2={16} {...p} opacity={0.5} /><line x1={18} y1={4} x2={18} y2={28} {...p} opacity={0.5} />{dot(10, 10)}{dot(13, 20)}{dot(9, 15)}{dot(25, 12)}{dot(27, 21)}{dot(23, 18)}</>;
      break;
    case "nested": // a bar with subgroup dots above
      body = <><rect x={6} y={16} width={24} height={11} rx={1.5} {...p} />{dot(10, 9)}{dot(15, 6)}{dot(21, 9)}{dot(26, 6)}<line x1={10} y1={11} x2={10} y2={16} {...p} /><line x1={26} y1={8} x2={26} y2={16} {...p} /></>;
      break;
    case "sets": // membership matrix: items down, sets across, a mark where a row belongs
      body = <>{[7, 16, 25].map((y, r) => [9, 18, 27].map((x, c) => { const on = (r + c) % 3 !== 1; return <g key={`${r}-${c}`}><rect x={x - 3.5} y={y - 3.5} width={7} height={7} rx={1} {...p} opacity={0.5} />{on && <circle cx={x} cy={y} r={1.8} fill="var(--accent)" stroke="none" opacity={0.9} />}</g>; }))}</>;
      break;
    case "timeline": // one bar per subject from its start to its end
      body = <>{([[5, 4, 12], [11, 4, 20], [17, 4, 8], [23, 4, 16]] as Array<[number, number, number]>).map(([y, x, w], i) => <rect key={i} x={x} y={y} width={w} height={4} rx={1} fill={i === 1 ? "var(--accent)" : "currentColor"} opacity={i === 1 ? 0.85 : 0.45} stroke="none" />)}<line x1={4} y1={29} x2={32} y2={29} {...p} opacity={0.6} /></>;
      break;
    case "meta": // one row per study: estimate + its lower/upper limits, a no-effect line
      body = <><line x1={18} y1={4} x2={18} y2={28} strokeDasharray="2 2" {...p} />{[7, 13, 19, 25].map((y, i) => { const lo = 6 + ((i * 3) % 5); const hi = 24 + ((i * 2) % 6); return <g key={i}><line x1={lo} y1={y} x2={hi} y2={y} {...p} /><rect x={(lo + hi) / 2 - 2} y={y - 2} width={4} height={4} fill="var(--accent)" stroke="none" opacity={0.85} /></g>; })}</>;
      break;
    case "edgelist": // rows of source → target links
      body = <>{[7, 16, 25].map((y, i) => <g key={i}>{dot(8, y)}<line x1={11} y1={y} x2={24} y2={y} {...p} /><polyline points={`21,${y - 2.5} 24,${y} 21,${y + 2.5}`} {...p} /><circle cx={28} cy={y} r={1.7} fill="var(--accent)" stroke="none" /></g>)}</>;
      break;
    case "association": // markers along the genome, one clearing the significance line
      body = <><line x1={4} y1={8} x2={32} y2={8} strokeDasharray="2 2" {...p} /><line x1={4} y1={28} x2={32} y2={28} {...p} opacity={0.6} />{[6, 9, 12, 15, 18, 21, 24, 27, 30].map((x, i) => <circle key={i} cx={x} cy={24 - ((i * 5) % 4)} r={1.4} fill={i < 4 ? "currentColor" : "var(--accent)"} stroke="none" opacity={0.85} />)}<circle cx={14} cy={5} r={1.6} fill="var(--accent)" stroke="none" /></>;
      break;
    case "alterations": // sample · gene · alteration events as coloured cells
      body = <>{[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => { const hit = (r + c) % 3 === 0; return <rect key={`${r}-${c}`} x={5 + c * 7} y={5 + r * 7.5} width={6} height={6.5} rx={0.8} fill={hit ? "var(--accent)" : "currentColor"} stroke="none" opacity={hit ? 0.9 : 0.18} />; }))}</>;
      break;
    default:
      body = dot(18, 16);
  }
  return <svg viewBox="0 0 36 32" width={36} height={30} aria-hidden="true">{body}</svg>;
}
