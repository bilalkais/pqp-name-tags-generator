import { PDFDocument } from 'pdf-lib';
import { getLayout } from './layouts.ts';
import { canvasSurface, pdfSurface, type RGB, type Surface } from './surface.ts';
import type { TextEngine, Weight } from './text.ts';

export interface Assets {
  text: TextEngine;
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
const BLUE: RGB = [0x17 / 255, 0x48 / 255, 0x96 / 255];
const YELLOW: RGB = [0xff / 255, 0xca / 255, 0x26 / 255];
const INK: RGB = [0x10 / 255, 0x24 / 255, 0x4a / 255];
const MUTED: RGB = [0.78, 0.8, 0.85];
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];

const CAP_HEIGHT = 0.714; // Noto Sans cap height / em
const mm = (v: number) => (v * 72) / 25.4;

/** A text style bound to the shaping engine. */
interface TextFont {
  width(text: string, size: number): number;
  draw(surface: Surface, text: string, size: number, x: number, baseline: number, color: RGB): void;
}

const textFont = (engine: TextEngine, weight: Weight): TextFont => ({
  width: (text, size) => engine.width(text, weight, size),
  draw: (surface, text, size, x, baseline, color) => engine.draw(surface, text, weight, size, x, baseline, color),
});

interface Fonts {
  semibold: TextFont;
  bold: TextFont;
}

interface Ctx {
  fonts: Fonts;
  /** Logo width / height. */
  logoAspect: number;
  settings: TagSettings;
}

async function makeCtx(text: TextEngine, settings: TagSettings, people: (Person | null)[], logoAspect: number): Promise<Ctx> {
  await text.ensureFonts([
    headerLine1(settings),
    headerLine2(settings),
    ...people.flatMap((p) => (p ? [p.name, p.country] : [])),
  ]);
  const fonts = { semibold: textFont(text, 'semibold'), bold: textFont(text, 'bold') };
  return { fonts, logoAspect, settings };
}

/** The word "Class" is fixed; the field holds only the class itself (e.g. "5"). */
export function headerLine1(s: TagSettings) {
  const cls = s.className.trim().replace(/^class\b\s*/i, '');
  return [s.title.trim(), cls && `Class ${cls}`].filter(Boolean).join(' ');
}
export const headerLine2 = (s: TagSettings) => `${MONTHS[s.month - 1]} ${s.year}`;

/** Largest size ≤ max at which every line fits within width. */
function fitSize(font: TextFont, lines: string[], width: number, max: number) {
  const widest = Math.max(...lines.map((l) => font.width(l, max)));
  return widest > width ? (max * width) / widest : max;
}

/** Split a name into two lines at the space that best balances their widths. */
function splitTwoLines(font: TextFont, text: string): string[] | null {
  const words = text.split(' ');
  if (words.length < 2) return null;
  let best: string[] | null = null;
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...lines.map((l) => font.width(l, 10)));
    if (w < bestWidth) {
      bestWidth = w;
      best = lines;
    }
  }
  return best;
}

function drawCentered(surface: Surface, text: string, font: TextFont, size: number, cx: number, baseline: number, color = INK) {
  font.draw(surface, text, size, cx - font.width(text, size) / 2, baseline, color);
}

/** Draw one tag with its bottom-left corner at (x, y). Units are PDF points. person = null draws a blank tag. */
function drawTag(page: Surface, ctx: Ctx, x: number, y: number, w: number, h: number, person: Person | null) {
  const { fonts, logoAspect, settings } = ctx;
  const headerH = Math.min(h * 0.3, w * 0.3);
  const stripeH = headerH * 0.16;
  const pad = w * 0.06;
  const top = y + h;

  // Header band; the logo's own background is the same blue, so it blends in.
  page.rect(x, top - headerH, w, headerH, BLUE);
  // Breathing room around the logo (also keeps image edges off the band edge).
  const logoInset = headerH * 0.12;
  const logoH = headerH - 2 * logoInset;
  const logoW = logoH * logoAspect;
  page.logo(x + logoInset * 1.5, top - headerH + logoInset, logoW, logoH);

  const textX = x + logoInset * 1.5 + logoW + pad * 0.4;
  const textW = x + w - pad * 0.7 - textX;
  const l1 = headerLine1(settings);
  const l2 = headerLine2(settings);
  const s1 = fitSize(fonts.bold, [l1 || ' '], textW, headerH * 0.3);
  const s2 = fitSize(fonts.semibold, [l2], textW, headerH * 0.2);
  const gap = headerH * 0.1;
  const blockH = s1 * CAP_HEIGHT + gap + s2 * CAP_HEIGHT;
  const b1 = top - headerH / 2 + blockH / 2 - s1 * CAP_HEIGHT;
  if (l1) fonts.bold.draw(page, l1, s1, textX, b1, WHITE);
  fonts.semibold.draw(page, l2, s2, textX, b1 - gap - s2 * CAP_HEIGHT, YELLOW);

  // Accent stripe.
  page.rect(x, y, w, stripeH, YELLOW);

  const bodyTop = top - headerH;
  const bodyBottom = y + stripeH;
  const bodyH = bodyTop - bodyBottom;
  const cx = x + w / 2;
  const availW = w - 2 * pad;

  if (!person) {
    // Blank tag for walk-ins: a faint writing line.
    const lineY = bodyBottom + bodyH * 0.4;
    page.line(x + pad, lineY, x + w - pad, lineY, 0.5, MUTED);
    return;
  }

  // Name: one line if it fits at a decent size, otherwise two balanced lines.
  const maxName = headerH * 0.55;
  const minOneLine = maxName * 0.8;
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

function drawCropMarks(page: Surface, ox: number, oy: number, cols: number, rows: number, tw: number, th: number) {
  const marginX = ox;
  const marginY = oy;
  const offset = mm(1.5);
  const lenX = Math.min(mm(6), marginX - offset - mm(1));
  const lenY = Math.min(mm(6), marginY - offset - mm(1));
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.line(x1, y1, x2, y2, 0.3, BLACK);
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
  const doc = await PDFDocument.create();
  doc.setTitle(`${headerLine1(settings)} name tags, ${headerLine2(settings)}`);
  doc.setCreator('PQP name tag generator');
  const logo = await doc.embedPng(assets.logo);
  const ctx = await makeCtx(assets.text, settings, people, logo.width / logo.height);
  const layout = getLayout(settings.layoutId);
  const pageW = mm(layout.pageW);
  const pageH = mm(layout.pageH);
  const tw = mm(layout.tagW);
  const th = mm(layout.tagH);
  const perPage = layout.cols * layout.rows;
  const ox = (pageW - layout.cols * tw) / 2;
  const oy = (pageH - layout.rows * th) / 2;

  for (let start = 0; start < people.length; start += perPage) {
    const page = pdfSurface(doc.addPage([pageW, pageH]), logo);
    people.slice(start, start + perPage).forEach((p, i) => {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      drawTag(page, ctx, ox + col * tw, oy + (layout.rows - 1 - row) * th, tw, th, p);
    });
    if (settings.cropMarks && perPage > 1) drawCropMarks(page, ox, oy, layout.cols, layout.rows, tw, th);
  }
  return doc.save();
}

/** Draw a single tag onto a canvas for the on-screen preview, sized to the canvas's CSS width. */
export async function renderPreview(
  canvas: HTMLCanvasElement,
  person: Person | null,
  settings: TagSettings,
  text: TextEngine,
  logo: ImageBitmap,
) {
  const ctx = await makeCtx(text, settings, [person], logo.width / logo.height);
  const layout = getLayout(settings.layoutId);
  const w = mm(layout.tagW);
  const h = mm(layout.tagH);
  const pxPerPt = (canvas.clientWidth * (window.devicePixelRatio || 1)) / w;
  canvas.width = Math.round(w * pxPerPt);
  canvas.height = Math.round(h * pxPerPt);
  const c = canvas.getContext('2d')!;
  c.setTransform(pxPerPt, 0, 0, pxPerPt, 0, 0);
  c.fillStyle = '#fff';
  c.fillRect(0, 0, w, h);
  drawTag(canvasSurface(c, h, logo), ctx, 0, 0, w, h, person);
}
