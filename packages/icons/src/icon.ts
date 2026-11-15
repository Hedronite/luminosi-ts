/** One icon: stroke-only path data on a 24 × 24 grid. */
export interface IconData {
  readonly id: string;
  readonly name: string;
  readonly paths: readonly string[];
}

export const ICON_VIEW_BOX = "0 0 24 24";
