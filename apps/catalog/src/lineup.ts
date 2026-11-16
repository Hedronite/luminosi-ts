/** The lineup's grid for a given width: as many columns as fit at about 140 px each, 3 to 7, with square cells. */
export function lineupLayout(width: number, count: number): { readonly cols: number; readonly cell: number; readonly height: number } {
  const cols = Math.min(7, Math.max(3, Math.floor(width / 140)));
  const cell = width / cols;
  return { cols, cell, height: Math.ceil(count / cols) * cell };
}
