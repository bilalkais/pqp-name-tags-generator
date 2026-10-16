import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getLayout } from './layouts.ts';

export interface Assets {
  regular: Uint8Array;
  semibold: Uint8Array;
  bold: Uint8Array;
  logo: Uint8Array;
}

export interface TagSettings {
  title: string;
  className: string;
  year: number;
  /** 1–12 */
  month: number;
  layoutId: string;
  cropMarks: boolean;
}

export interface Person {
  name: string;
  country: string;
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Colours sampled from the CEM logo.
const BLUE = rgb(0x17 / 255, 0x48 / 255, 0x96 / 255);
const YELLOW = rgb(0xff / 255, 0xca / 255, 0x26 / 255);
const INK = rgb(0x10 / 255, 0x24 / 255, 0x4a / 255);
const MUTED = rgb(0.78, 0.8, 0.85);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

const CAP_HEIGHT = 0.714; // Noto Sans cap height / em
const mm = (v: number) => (v * 72) / 25.4;

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

interface Ctx {
  fonts: Fonts;
  logo: PDFImage;
  settings: TagSettings;
}

async function setup(assets: Assets, settings: TagSettings) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, semibold, bold] = await Promise.all([
    doc.embedFont(assets.regular, { subset: true }),
    doc.embedFont(assets.semibold, { subset: true }),
    doc.embedFont(assets.bold, { subset: true }),
  ]);
  const logo = await doc.embedPng(assets.logo);
  doc.setTitle(`${headerLine1(settings)} name tags, ${headerLine2(settings)}`);
  doc.setCreator('PQP name tag generator');
  const ctx: Ctx = { fonts: { regular, semibold, bold }, logo, settings };
  return { doc, ctx };
}

/** The word "Class" is fixed; the field holds only the class itself (e.g. "5"). */
export function headerLine1(s: TagSettings) {
  const cls = s.className.trim().replace(/^class\b\s*/i, '');
  return [s.title.trim(), cls && `Class ${cls}`].filter(Boolean).join(' ');
}
export const headerLine2 = (s: TagSettings) => `${MONTHS[s.month - 1]} ${s.year}`;

/** Largest size ≤ max at which every line fits within width. */
function fitSize(font: PDFFont, lines: string[], width: number, max: number) {
  const widest = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, max)));
  return widest > width ? (max * width) / widest : max;
}

/** Split a name into two lines at the space that best balances their widths. */
function splitTwoLines(font: PDFFont, text: string): string[] | null {
  const words = text.split(' ');
  if (words.length < 2) return null;
  let best: string[] | null = null;
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, 10)));
    if (w < bestWidth) {
      bestWidth = w;
      best = lines;
    }
  }
  return best;
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, cx: number, baseline: number, color = INK) {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color });
}

/** Draw one tag with its bottom-left corner at (x, y). Units are PDF points. person = null draws a blank tag. */
function drawTag(page: PDFPage, ctx: Ctx, x: number, y: number, w: number, h: number, person: Person | null) {
  const { fonts, logo, settings } = ctx;
  const headerH = Math.min(h * 0.3, w * 0.3);
  const stripeH = headerH * 0.16;
  const pad = w * 0.06;
  const top = y + h;

  // Header band; the logo's own background is the same blue, so it blends in.
  page.drawRectangle({ x, y: top - headerH, width: w, height: headerH, color: BLUE });
  // Breathing room around the logo (also keeps image edges off the band edge).
  const logoInset = headerH * 0.12;
  const logoH = headerH - 2 * logoInset;
  const logoW = (logoH * logo.width) / logo.height;
  page.drawImage(logo, { x: x + logoInset * 1.5, y: top - headerH + logoInset, width: logoW, height: logoH });

  const textX = x + logoInset * 1.5 + logoW + pad * 0.4;
  const textW = x + w - pad * 0.7 - textX;
  const l1 = headerLine1(settings);
  const l2 = headerLine2(settings);
  const s1 = fitSize(fonts.bold, [l1 || ' '], textW, headerH * 0.3);
  const s2 = fitSize(fonts.semibold, [l2], textW, headerH * 0.2);
  const gap = headerH * 0.1;
  const blockH = s1 * CAP_HEIGHT + gap + s2 * CAP_HEIGHT;
  const b1 = top - headerH / 2 + blockH / 2 - s1 * CAP_HEIGHT;
  if (l1) page.drawText(l1, { x: textX, y: b1, size: s1, font: fonts.bold, color: WHITE });
  page.drawText(l2, { x: textX, y: b1 - gap - s2 * CAP_HEIGHT, size: s2, font: fonts.semibold, color: YELLOW });

  // Accent stripe.
  page.drawRectangle({ x, y, width: w, height: stripeH, color: YELLOW });

  const bodyTop = top - headerH;
  const bodyBottom = y + stripeH;
  const bodyH = bodyTop - bodyBottom;
  const cx = x + w / 2;
  const availW = w - 2 * pad;

  if (!person) {
    // Blank tag for walk-ins: a faint writing line.
    const lineY = bodyBottom + bodyH * 0.4;
    page.drawLine({ start: { x: x + pad, y: lineY }, end: { x: x + w - pad, y: lineY }, thickness: 0.5, color: MUTED });
    return;
  }

  // Name: one line if it fits at a decent size, otherwise two balanced lines.
  const maxName = headerH * 0.55;
  const minOneLine = maxName * 0.6;
  let lines = [person.name];
  let nameSize = fitSize(fonts.bold, lines, availW, maxName);
  if (nameSize < minOneLine) {
    const two = splitTwoLines(fonts.bold, person.name);
    if (two) {
      const twoSize = fitSize(fonts.bold, two, availW, maxName * 0.8);
      if (twoSize > nameSize) {
        lines = two;
        nameSize = twoSize;
      }
    }
  }
  let countrySize = person.country ? fitSize(fonts.semibold, [person.country], availW, maxName * 0.42) : 0;

  const blockHeight = () =>
    nameSize * CAP_HEIGHT +
    (lines.length - 1) * nameSize * 1.12 +
    (countrySize ? nameSize * 0.6 + countrySize * CAP_HEIGHT : 0);
  // Shrink everything if the block is too tall for the body area.
  const maxBlock = bodyH * 0.78;
  if (blockHeight() > maxBlock) {
    const k = maxBlock / blockHeight();
    nameSize *= k;
    countrySize *= k;
  }
  const step = nameSize * 1.12;
  const total = blockHeight();
  let baseline = bodyBottom + bodyH / 2 + total / 2 - nameSize * CAP_HEIGHT;
  for (const line of lines) {
    drawCentered(page, line, fonts.bold, nameSize, cx, baseline);
    baseline -= step;
  }
  if (countrySize) {
    baseline += step - nameSize * 0.6 - countrySize * CAP_HEIGHT;
    drawCentered(page, person.country, fonts.semibold, countrySize, cx, baseline, BLUE);
  }
}

function drawCropMarks(page: PDFPage, ox: number, oy: number, cols: number, rows: number, tw: number, th: number) {
  const marginX = ox;
  const marginY = oy;
  const offset = mm(1.5);
  const lenX = Math.min(mm(6), marginX - offset - mm(1));
  const lenY = Math.min(mm(6), marginY - offset - mm(1));
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.3, color: BLACK });
  const right = ox + cols * tw;
  const top = oy + rows * th;
  if (lenY > mm(2)) {
    for (let c = 0; c <= cols; c++) {
      const xx = ox + c * tw;
      line(xx, top + offset, xx, top + offset + lenY);
      line(xx, oy - offset, xx, oy - offset - lenY);
    }
  }
  if (lenX > mm(2)) {
    for (let r = 0; r <= rows; r++) {
      const yy = oy + r * th;
      line(ox - offset, yy, ox - offset - lenX, yy);
      line(right + offset, yy, right + offset + lenX, yy);
    }
  }
}

/** Build the print PDF. null entries are blank tags. */
export async function buildSheetPdf(people: (Person | null)[], settings: TagSettings, assets: Assets): Promise<Uint8Array> {
  const { doc, ctx } = await setup(assets, settings);
  const layout = getLayout(settings.layoutId);
  const pageW = mm(layout.pageW);
  const pageH = mm(layout.pageH);
  const tw = mm(layout.tagW);
  const th = mm(layout.tagH);
  const perPage = layout.cols * layout.rows;
  const ox = (pageW - layout.cols * tw) / 2;
  const oy = (pageH - layout.rows * th) / 2;

  for (let start = 0; start < people.length; start += perPage) {
    const page = doc.addPage([pageW, pageH]);
    people.slice(start, start + perPage).forEach((p, i) => {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      drawTag(page, ctx, ox + col * tw, oy + (layout.rows - 1 - row) * th, tw, th, p);
    });
    if (settings.cropMarks && perPage > 1) drawCropMarks(page, ox, oy, layout.cols, layout.rows, tw, th);
  }
  return doc.save();
}

/** A single tag on a page of exactly its size, for the on-screen preview. */
export async function buildPreviewPdf(person: Person | null, settings: TagSettings, assets: Assets): Promise<Uint8Array> {
  const { doc, ctx } = await setup(assets, settings);
  const layout = getLayout(settings.layoutId);
  const w = mm(layout.tagW);
  const h = mm(layout.tagH);
  const page = doc.addPage([w, h]);
  drawTag(page, ctx, 0, 0, w, h, person);
  return doc.save();
}
