// All sizes in millimetres.
export interface Layout {
  id: string;
  label: string;
  pageW: number;
  pageH: number;
  tagW: number;
  tagH: number;
  cols: number;
  rows: number;
}

export const LAYOUTS: Layout[] = [
  { id: '90x55-a4', label: '90 × 55 mm, 10 per A4 sheet', pageW: 210, pageH: 297, tagW: 90, tagH: 55, cols: 2, rows: 5 },
  { id: '100x70-a4', label: '100 × 70 mm, 8 per A4 sheet', pageW: 210, pageH: 297, tagW: 100, tagH: 70, cols: 2, rows: 4 },
  { id: 'a6', label: 'A6 portrait (105 × 148 mm), 1 per A6 page', pageW: 105, pageH: 148, tagW: 105, tagH: 148, cols: 1, rows: 1 },
  { id: '86x54', label: '86 × 54 mm card, 1 per page (badge printer)', pageW: 86, pageH: 54, tagW: 86, tagH: 54, cols: 1, rows: 1 },
];

export const DEFAULT_LAYOUT_ID = '90x55-a4';

export function getLayout(id: string): Layout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}
