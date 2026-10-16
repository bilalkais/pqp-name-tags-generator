import type { Font as HbFont } from 'harfbuzzjs';
import type { Color, PDFPage } from 'pdf-lib';

// Text is shaped with HarfBuzz (joined Arabic, Indic reordering, mark placement, RTL)
// and drawn as vector outlines, so any script prints correctly with the right font.

export type Weight = 'semibold' | 'bold';

const BASE: Record<Weight, string> = {
  semibold: 'fonts/NotoSans-SemiBold.ttf',
  bold: 'fonts/NotoSans-Bold.ttf',
};

type Range = [number, number];
const S = (name: string) => `fonts/scripts/${name}`;

/** Fallback fonts by Unicode range. They are downloaded only when a name needs them. */
const FALLBACKS: { files: string[]; ranges: Range[]; cjk?: boolean }[] = [
  { files: [S('NotoSansArabic-Bold.ttf')], ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x0870, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]] },
  { files: [S('NotoSansHebrew-Bold.ttf')], ranges: [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]] },
  { files: [S('NotoSansSyriac-Regular.ttf')], ranges: [[0x0700, 0x074f], [0x0860, 0x086f]] },
  { files: [S('NotoSansThaana-Bold.ttf')], ranges: [[0x0780, 0x07bf]] },
  { files: [S('NotoSansArmenian-Bold.ttf')], ranges: [[0x0530, 0x058f], [0xfb13, 0xfb17]] },
  { files: [S('NotoSansGeorgian-Bold.ttf')], ranges: [[0x10a0, 0x10ff], [0x1c90, 0x1cbf], [0x2d00, 0x2d2f]] },
  { files: [S('NotoSansEthiopic-Bold.ttf')], ranges: [[0x1200, 0x139f], [0x2d80, 0x2ddf], [0xab00, 0xab2f]] },
  { files: [S('NotoSansDevanagari-Bold.ttf')], ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff]] },
  { files: [S('NotoSansBengali-Bold.ttf')], ranges: [[0x0980, 0x09ff]] },
  { files: [S('NotoSansGurmukhi-Bold.ttf')], ranges: [[0x0a00, 0x0a7f]] },
  { files: [S('NotoSansGujarati-Bold.ttf')], ranges: [[0x0a80, 0x0aff]] },
  { files: [S('NotoSansOriya-Bold.ttf')], ranges: [[0x0b00, 0x0b7f]] },
  { files: [S('NotoSansTamil-Bold.ttf')], ranges: [[0x0b80, 0x0bff]] },
  { files: [S('NotoSansTelugu-Bold.ttf')], ranges: [[0x0c00, 0x0c7f]] },
  { files: [S('NotoSansKannada-Bold.ttf')], ranges: [[0x0c80, 0x0cff]] },
  { files: [S('NotoSansMalayalam-Bold.ttf')], ranges: [[0x0d00, 0x0d7f]] },
  { files: [S('NotoSansSinhala-Bold.ttf')], ranges: [[0x0d80, 0x0dff]] },
  { files: [S('NotoSansThai-Bold.ttf')], ranges: [[0x0e00, 0x0e7f]] },
  { files: [S('NotoSansLao-Bold.ttf')], ranges: [[0x0e80, 0x0eff]] },
  { files: [S('NotoSerifTibetan-Bold.ttf')], ranges: [[0x0f00, 0x0fff]] },
  { files: [S('NotoSansMyanmar-Bold.ttf')], ranges: [[0x1000, 0x109f], [0xa9e0, 0xa9ff], [0xaa60, 0xaa7f]] },
  { files: [S('NotoSansKhmer-Bold.ttf')], ranges: [[0x1780, 0x17ff], [0x19e0, 0x19ff]] },
  { files: [S('NotoSansMongolian-Regular.ttf')], ranges: [[0x1800, 0x18af]] },
  {
    // Han, kana, Hangul and CJK punctuation. The order is adjusted per name (see cjkOrder).
    files: [S('NotoSansSC-Bold.otf'), S('NotoSansTC-Bold.otf'), S('NotoSansJP-Bold.otf'), S('NotoSansKR-Bold.otf')],
    ranges: [
      [0x1100, 0x11ff], [0x2e80, 0x2fdf], [0x3000, 0x31ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa960, 0xa97f],
      [0xac00, 0xd7ff], [0xf900, 0xfaff], [0xff00, 0xffef], [0x20000, 0x3134f],
    ],
    cjk: true,
  },
];

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/;
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;
const MARK = /[\p{M}‌‍]/u;

/** Han characters look different per region: prefer Japanese with kana, Korean with Hangul. */
function cjkOrder(text: string, files: string[]) {
  const first = KANA.test(text) ? 'JP' : HANGUL.test(text) ? 'KR' : 'SC';
  return [...files].sort((a, b) => Number(b.includes(`Sans${first}`)) - Number(a.includes(`Sans${first}`)));
}

interface LoadedFont {
  font: HbFont;
  upem: number;
  coverage: Set<number>;
  paths: Map<number, string>;
}

interface Glyph {
  font: LoadedFont;
  gid: number;
  /** Position in em units. */
  x: number;
  y: number;
}

interface Shaped {
  glyphs: Glyph[];
  /** Advance width in em units. */
  width: number;
}

type HarfBuzz = typeof import('harfbuzzjs');

export class TextEngine {
  private fonts = new Map<string, Promise<LoadedFont | null>>();
  private loaded = new Map<string, LoadedFont | null>();
  private shapes = new Map<string, Shaped>();

  private hb: HarfBuzz;
  private fetchFont: (path: string) => Promise<Uint8Array>;

  private constructor(hb: HarfBuzz, fetchFont: (path: string) => Promise<Uint8Array>) {
    this.hb = hb;
    this.fetchFont = fetchFont;
  }

  /** fetchFont receives paths such as "fonts/NotoSans-Bold.ttf" (relative to the site root). */
  static async create(fetchFont: (path: string) => Promise<Uint8Array>) {
    const engine = new TextEngine(await import('harfbuzzjs'), fetchFont);
    const base = await Promise.all(Object.values(BASE).map((f) => engine.loadFont(f)));
    if (base.some((f) => !f)) throw new Error('Could not load the base fonts');
    return engine;
  }

  private loadFont(path: string): Promise<LoadedFont | null> {
    let p = this.fonts.get(path);
    if (!p) {
      p = this.fetchFont(path)
        .then((bytes) => {
          const face = new this.hb.Face(new this.hb.Blob(bytes));
          return { font: new this.hb.Font(face), upem: face.upem, coverage: new Set(face.collectUnicodes()), paths: new Map() };
        })
        .catch(() => null)
        .then((f) => {
          this.loaded.set(path, f);
          return f;
        });
      this.fonts.set(path, p);
    }
    return p;
  }

  private candidates(cp: number, text: string): string[] {
    const spec = FALLBACKS.find((f) => f.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (!spec) return [];
    return spec.cjk ? cjkOrder(text, spec.files) : spec.files;
  }

  /** The loaded font that will draw this character, if any. */
  private resolve(cp: number, weight: Weight, text: string): LoadedFont | undefined {
    const base = this.loaded.get(BASE[weight])!;
    if (base.coverage.has(cp)) return base;
    for (const file of this.candidates(cp, text)) {
      const f = this.loaded.get(file);
      if (f?.coverage.has(cp)) return f;
    }
    return undefined;
  }

  /** Download whatever fallback fonts these texts need. */
  async ensureFonts(texts: string[]) {
    for (;;) {
      const need = new Set<string>();
      for (const text of texts) {
        for (const ch of text) {
          const cp = ch.codePointAt(0)!;
          if (this.resolve(cp, 'bold', text)) continue;
          const next = this.candidates(cp, text).find((f) => !this.loaded.has(f));
          if (next) need.add(next);
        }
      }
      if (need.size === 0) return;
      await Promise.all([...need].map((f) => this.loadFont(f)));
    }
  }

  /** Characters no available font can draw. Call ensureFonts first. */
  unsupported(text: string): string[] {
    const bad = new Set<string>();
    for (const ch of text) {
      if (/\s/.test(ch) || ch === '‌' || ch === '‍') continue;
      if (!this.resolve(ch.codePointAt(0)!, 'bold', text)) bad.add(ch);
    }
    return [...bad];
  }

  /** Remove characters no font can draw (emoji, flags, …) and tidy up what's left. Call ensureFonts first. */
  printable(text: string): { text: string; removed: string[] } {
    const removed = this.unsupported(text);
    if (removed.length === 0) return { text, removed };
    const cleaned = [...text]
      .filter((ch) => !removed.includes(ch))
      .join('')
      .replace(/(?<![\p{L}\p{M}])[‌‍]|[‌‍](?![\p{L}\p{M}])/gu, '') // joiners left dangling
      .replace(/\(\s*\)|\[\s*\]/g, '') // brackets left empty
      .replace(/([([])\s+/g, '$1')
      .replace(/\s+([)\]])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return { text: cleaned, removed };
  }

  private shape(text: string, weight: Weight): Shaped {
    const key = `${weight}\u0000${text}`;
    const cached = this.shapes.get(key);
    if (cached) return cached;

    // Split into runs that share a font. Marks stay with their base letter; spaces, digits
    // and punctuation stay in the current run when its font has them.
    const base = this.loaded.get(BASE[weight])!;
    const runs: { font: LoadedFont; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const last = runs[runs.length - 1];
      if (last && (MARK.test(ch) || (!LETTER.test(ch) && last.font.coverage.has(cp)))) {
        last.text += ch;
        continue;
      }
      const font = this.resolve(cp, weight, text) ?? base;
      if (last && last.font === font) last.text += ch;
      else runs.push({ font, text: ch });
    }

    const shapedRuns = runs.map(({ font, text: runText }) => {
      const buf = new this.hb.Buffer();
      buf.addText(runText);
      buf.guessSegmentProperties();
      this.hb.shape(font.font, buf);
      const positions = buf.getGlyphPositions();
      let x = 0;
      const glyphs = buf.getGlyphInfos().map((info, i) => {
        const p = positions[i];
        const g = { font, gid: info.codepoint, x: (x + p.xOffset) / font.upem, y: p.yOffset / font.upem };
        x += p.xAdvance;
        return g;
      });
      return { glyphs, width: x / font.upem };
    });

    // Right-to-left names (Arabic, Hebrew, …) lay their runs out from the right.
    const firstLetter = [...text].find((ch) => LETTER.test(ch));
    if (firstLetter && RTL_LETTER.test(firstLetter)) shapedRuns.reverse();

    const glyphs: Glyph[] = [];
    let offset = 0;
    for (const run of shapedRuns) {
      for (const g of run.glyphs) glyphs.push({ ...g, x: g.x + offset });
      offset += run.width;
    }
    const shaped = { glyphs, width: offset };
    this.shapes.set(key, shaped);
    return shaped;
  }

  width(text: string, weight: Weight, size: number) {
    return this.shape(text, weight).width * size;
  }

  /** SVG path for a glyph, flipped to y-down (what pdf-lib's drawSvgPath expects). */
  private glyphPath(font: LoadedFont, gid: number) {
    let path = font.paths.get(gid);
    if (path === undefined) {
      path = font.font
        .glyphToJson(gid)
        .map(({ type, values }) => type + values.map((v, i) => (i % 2 ? -v : v)).join(' '))
        .join('');
      font.paths.set(gid, path);
    }
    return path;
  }

  /** Draw text with its left edge at x and its baseline at y (PDF points). */
  draw(page: PDFPage, text: string, weight: Weight, size: number, x: number, y: number, color: Color) {
    for (const g of this.shape(text, weight).glyphs) {
      const path = this.glyphPath(g.font, g.gid);
      if (!path) continue;
      page.drawSvgPath(path, { x: x + g.x * size, y: y + g.y * size, scale: size / g.font.upem, color });
    }
  }
}
