import { mix, type Palette } from '../../ui/theme';
import { FONT, MONO } from '../../ui/font';

/** Shared drawing for the dynamic-programming tables in this section. */

export type Cell = readonly [number, number];

export { FONT, MONO } from '../../ui/font';

/** Keeps single-unit printable characters and cuts to `max`. Used on typed and URL input alike. */
export function clean(text: string, max: number): string {
  return [...text]
    .filter((ch) => ch.length === 1 && ch >= ' ' && ch !== '\u007f')
    .slice(0, max)
    .join('');
}

/** A character as drawn: spaces get a visible mark. */
export const glyph = (ch: string): string => (ch === ' ' ? '␣' : ch);

export interface TableSpec {
  /** Region of the canvas to fit the table into, in CSS pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Header labels; their lengths set the number of rows and columns. */
  rowHead: readonly string[];
  colHead: readonly string[];
  /** Width of the row-header column in cell widths. Default 1. */
  headWidth?: number;
  /** Adds a strip of row and column numbers outside the headers. */
  indices?: boolean;
  /** The text of a cell, or undefined while it is not yet computed. */
  value(row: number, col: number): string | undefined;
  /** The cell being computed. */
  current?: Cell;
  /** Cells the current one reads from: outlined, with an arrow to the current cell. */
  reads?: readonly Cell[];
  /** Traceback cells: tinted and joined by a line. */
  path?: readonly Cell[];
  /** Optional small corner mark, as a colour. */
  mark?(row: number, col: number): string | undefined;
  /** Optional header colours, to tie rows to things drawn elsewhere. */
  rowColour?(row: number): string | undefined;
}

export interface TableGeometry {
  cw: number;
  ch: number;
  /** Centre of a cell. */
  centre(row: number, col: number): [number, number];
  /** Right and bottom edge of what was drawn. */
  right: number;
  bottom: number;
}

export function drawTable(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  spec: TableSpec,
): TableGeometry {
  const rows = spec.rowHead.length;
  const cols = spec.colHead.length;
  const headWidth = spec.headWidth ?? 1;
  const strip = spec.indices ? 0.7 : 0;
  // Cells may be wider than tall, but not by much, and never huge.
  const ch = Math.min(56, spec.h / (rows + 1 + strip));
  const cw = Math.min(ch * 1.7, 84, spec.w / (cols + headWidth + strip));
  const totalW = cw * (cols + headWidth + strip);
  const totalH = ch * (rows + 1 + strip);
  const left = spec.x + (spec.w - totalW) / 2 + cw * (headWidth + strip);
  const top = spec.y + (spec.h - totalH) / 2 + ch * (1 + strip);
  const cellX = (col: number) => left + col * cw;
  const cellY = (row: number) => top + row * ch;
  const centre = (row: number, col: number): [number, number] => [
    cellX(col) + cw / 2,
    cellY(row) + ch / 2,
  ];
  const key = (cell: Cell) => cell[0] * 1000 + cell[1];
  const onPath = new Set((spec.path ?? []).map(key));

  let longest = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) longest = Math.max(longest, spec.value(r, c)?.length ?? 0);
  }
  const size = Math.max(6, Math.min(16, ch * 0.62, (cw * 0.8) / (longest * 0.64)));
  const headSize = Math.max(6, Math.min(16, ch * 0.62));
  const widestHead = Math.max(1, ...spec.colHead.map((label) => label.length));
  const colSize = Math.min(headSize, (cw * 0.8) / (widestHead * 0.64));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  // Headers.
  const [curRow, curCol] = spec.current ?? [-1, -1];
  for (let c = 0; c < cols; c++) {
    ctx.font = `${c === curCol ? '600 ' : ''}${colSize}px ${FONT}`;
    ctx.fillStyle = c === curCol ? palette.change : palette.ink;
    ctx.fillText(spec.colHead[c], cellX(c) + cw / 2, top - ch / 2);
    if (spec.indices) {
      ctx.font = `${headSize * 0.68}px ${FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(String(c), cellX(c) + cw / 2, top - ch * (1 + strip / 2));
    }
  }
  for (let r = 0; r < rows; r++) {
    const label = spec.rowHead[r];
    const width = cw * headWidth;
    const colour = spec.rowColour?.(r);
    if (colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(left - width, cellY(r) + 2, Math.max(2, cw * 0.12), ch - 4);
    }
    ctx.font = `${r === curRow ? '600 ' : ''}${Math.min(headSize, (width * 0.9) / (label.length * 0.56 || 1))}px ${FONT}`;
    ctx.fillStyle = r === curRow ? palette.change : palette.ink;
    ctx.fillText(label, left - width / 2 + (colour ? cw * 0.06 : 0), cellY(r) + ch / 2);
    if (spec.indices) {
      ctx.font = `${headSize * 0.68}px ${FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(String(r), left - width - (cw * strip) / 2, cellY(r) + ch / 2);
    }
  }

  // Cell backgrounds.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isCurrent = r === curRow && c === curCol;
      const fill = isCurrent
        ? mix(palette.bg, palette.change, 0.3)
        : onPath.has(key([r, c]))
          ? mix(palette.bg, palette.good, 0.38)
          : undefined;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(cellX(c), cellY(r), cw, ch);
      }
      const mark = spec.mark?.(r, c);
      if (mark && spec.value(r, c) !== undefined) {
        const m = Math.min(cw, ch) * 0.3;
        ctx.fillStyle = mark;
        ctx.beginPath();
        ctx.moveTo(cellX(c), cellY(r));
        ctx.lineTo(cellX(c) + m, cellY(r));
        ctx.lineTo(cellX(c), cellY(r) + m);
        ctx.fill();
      }
    }
  }

  // Grid.
  ctx.strokeStyle = palette.faint;
  ctx.beginPath();
  for (let r = 0; r <= rows; r++) {
    ctx.moveTo(left, Math.round(cellY(r)) + 0.5);
    ctx.lineTo(left + cols * cw, Math.round(cellY(r)) + 0.5);
  }
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(Math.round(cellX(c)) + 0.5, top);
    ctx.lineTo(Math.round(cellX(c)) + 0.5, top + rows * ch);
  }
  ctx.stroke();

  // Traceback line.
  if (spec.path && spec.path.length > 1) {
    ctx.strokeStyle = palette.good;
    ctx.lineWidth = Math.max(1.5, Math.min(cw, ch) * 0.09);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    spec.path.forEach(([r, c], i) => {
      const [px, py] = centre(r, c);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  // Values.
  ctx.font = `${size}px ${FONT}`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const text = spec.value(r, c);
      if (text === undefined) continue;
      ctx.fillStyle = palette.ink;
      ctx.fillText(text, cellX(c) + cw / 2, cellY(r) + ch / 2 + 0.5);
    }
  }

  // Cells read by the current one.
  if (spec.current) {
    const [tx, ty] = centre(curRow, curCol);
    const inset = Math.min(cw, ch) * 0.34;
    ctx.strokeStyle = palette.compare;
    ctx.fillStyle = palette.compare;
    for (const [r, c] of spec.reads ?? []) {
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cellX(c) + 1, cellY(r) + 1, cw - 2, ch - 2);
      const [sx, sy] = centre(r, c);
      const length = Math.hypot(tx - sx, ty - sy);
      if (length < 1) continue;
      const ux = (tx - sx) / length;
      const uy = (ty - sy) / length;
      // Leave room for the numbers at both ends.
      const gapX = ux === 0 ? Infinity : (cw * 0.5 - 1) / Math.abs(ux);
      const gapY = uy === 0 ? Infinity : (ch * 0.5 - 1) / Math.abs(uy);
      const gap = Math.min(Math.min(gapX, gapY) * 0.72, length * 0.36, Math.max(inset, 1));
      const head = Math.max(3, Math.min(cw, ch) * 0.2);
      const ex = tx - ux * gap;
      const ey = ty - uy * gap;
      ctx.beginPath();
      ctx.moveTo(sx + ux * gap, sy + uy * gap);
      ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * head - uy * head * 0.5, ey - uy * head + ux * head * 0.5);
      ctx.lineTo(ex - ux * head + uy * head * 0.5, ey - uy * head - ux * head * 0.5);
      ctx.fill();
    }
    ctx.strokeStyle = palette.change;
    ctx.lineWidth = 2;
    ctx.strokeRect(cellX(curCol) + 1, cellY(curRow) + 1, cw - 2, ch - 2);
  }

  ctx.restore();
  return { cw, ch, centre, right: left + cols * cw, bottom: top + rows * ch };
}

/**
 * Splits a player position into the two phases every table demo has: `filled`
 * cells computed so far, then `back` steps of the traceback.
 */
export function phases(position: number, fillSteps: number): { filled: number; back: number } {
  return { filled: Math.min(position, fillSteps), back: Math.max(0, position - fillSteps) };
}

/** Draws a row of characters in equal slots; returns the slot centre for an index. */
export function drawLetters(
  ctx: CanvasRenderingContext2D,
  letters: readonly string[],
  x: number,
  y: number,
  slot: number,
  size: number,
  colour: (index: number) => string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${MONO}`;
  letters.forEach((ch, i) => {
    ctx.fillStyle = colour(i);
    ctx.fillText(glyph(ch), x + slot * (i + 0.5), y);
  });
  ctx.restore();
}
