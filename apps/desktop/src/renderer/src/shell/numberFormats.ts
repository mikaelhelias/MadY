import type { NumberFormat } from "@mady/core";

/**
 * Every way an axis's numbers can be written, each with an example of what it prints. One list
 * behind the Axis tab's Numbering, the parallel-axis panel, the 3-D axis panel and the right-click
 * menu on an axis's numbers, so the places cannot drift apart or promise an example the axis does
 * not draw. A Record, so a new format cannot be left out of any of them.
 * "auto" is not here: each place words its own default.
 */
const LABELS: Record<Exclude<NumberFormat, "auto">, string> = {
  decimal: "Decimal (1500)",
  scientific: "Scientific (1.5×10³)",
  enotation: "E notation (1.5E3)",
  power10: "Power of 10 (10³)",
  antilog: "Antilog (1, 10, 100)",
  si: "Short (1.5k, 2M)",
  percent: "Percentage (×100 %)",
};

export const NUMBER_FORMAT_CHOICES: ReadonlyArray<{ value: Exclude<NumberFormat, "auto">; label: string }> = (
  Object.keys(LABELS) as Array<Exclude<NumberFormat, "auto">>
).map((value) => ({ value, label: LABELS[value] }));
