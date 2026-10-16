import { rgb, type PDFImage, type PDFPage } from 'pdf-lib';

/** 0–1 per channel. */
export type RGB = [number, number, number];

/**
 * What a tag is drawn onto: a PDF page for printing or a canvas for the preview.
 * Coordinates are PDF points with the origin at the bottom-left.
 */
export interface Surface {
  rect(x: number, y: number, w: number, h: number, color: RGB): void;
  logo(x: number, y: number, w: number, h: number): void;
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color: RGB): void;
  /** An SVG path (y-down) placed at (x, y) and scaled. */
  path(svg: string, x: number, y: number, scale: number, color: RGB): void;
}

export function pdfSurface(page: PDFPage, logo: PDFImage): Surface {
  const c = (color: RGB) => rgb(...color);
  return {
    rect: (x, y, width, height, color) => page.drawRectangle({ x, y, width, height, color: c(color) }),
    logo: (x, y, width, height) => page.drawImage(logo, { x, y, width, height }),
    line: (x1, y1, x2, y2, thickness, color) =>
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: c(color) }),
    path: (svg, x, y, scale, color) => page.drawSvgPath(svg, { x, y, scale, color: c(color) }),
  };
}

/** ctx must already be scaled so one unit is one PDF point; pageH is the drawing height in points. */
export function canvasSurface(ctx: CanvasRenderingContext2D, pageH: number, logo: CanvasImageSource): Surface {
  const css = (color: RGB) => `rgb(${color.map((v) => Math.round(v * 255)).join(',')})`;
  const paths = new Map<string, Path2D>();
  return {
    rect(x, y, w, h, color) {
      ctx.fillStyle = css(color);
      ctx.fillRect(x, pageH - y - h, w, h);
    },
    logo(x, y, w, h) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logo, x, pageH - y - h, w, h);
    },
    line(x1, y1, x2, y2, thickness, color) {
      ctx.strokeStyle = css(color);
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(x1, pageH - y1);
      ctx.lineTo(x2, pageH - y2);
      ctx.stroke();
    },
    path(svg, x, y, scale, color) {
      let p = paths.get(svg);
      if (!p) paths.set(svg, (p = new Path2D(svg)));
      ctx.save();
      ctx.translate(x, pageH - y);
      ctx.scale(scale, scale);
      ctx.fillStyle = css(color);
      ctx.fill(p);
      ctx.restore();
    },
  };
}
