import type { TreeLayout } from '../../core/structures/layout';
import type { Role } from '../../core/structures/trace';
import { hexToRgb, mix, type Palette } from '../../ui/theme';

export interface Point {
  x: number;
  y: number;
}

/** What a demo's draw function gets: the canvas in CSS pixels, the palette, and a way to animate positions. */
export interface Gfx {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  palette: Palette;
  /**
   * Where to draw the thing called `id` whose resting place in this frame is
   * (x, y). Between frames this glides from where the same id was last drawn.
   */
  place(id: string | number, x: number, y: number): Point;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const font = (px: number, bold = false) =>
  `${bold ? '600 ' : ''}${Math.round(px * 10) / 10}px system-ui, sans-serif`;

export function roleColour(palette: Palette, role: Role | undefined): string | undefined {
  if (role === 'compare') return palette.compare;
  if (role === 'change') return palette.change;
  if (role === 'good') return palette.good;
  if (role === 'visit') return palette.visit;
  return undefined;
}

/** Ink or background, whichever reads better on `fill`. */
export function contrast(palette: Palette, fill: string): string {
  const luminance = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const f = luminance(fill);
  return Math.abs(luminance(palette.ink) - f) > Math.abs(luminance(palette.bg) - f)
    ? palette.ink
    : palette.bg;
}

/** A soft version of a highlight colour, for filling a node behind dark text. */
export const tint = (palette: Palette, colour: string, amount = 0.3) =>
  mix(palette.bg, colour, amount);

export interface Fit {
  /** Pixels per layout unit. */
  unit: number;
  x(u: number): number;
  y(depth: number): number;
  levelGap: number;
}

/** Scales a tree layout into `box`, centred, never larger than `maxUnit` px per unit. */
export function fitTree(layout: TreeLayout<unknown>, box: Box, maxUnit = 44, maxLevel = 64): Fit {
  const unit = Math.min(maxUnit, box.w / Math.max(1, layout.width));
  const levels = Math.max(1, layout.depth);
  const nodeHeight = Math.min(unit, 30);
  const levelGap = levels > 1 ? Math.min(maxLevel, (box.h - nodeHeight) / (levels - 1)) : 0;
  const left = box.x + (box.w - layout.width * unit) / 2;
  const used = nodeHeight + levelGap * (levels - 1);
  const top = box.y + Math.min((box.h - used) / 2, box.h * 0.22) + nodeHeight / 2;
  return {
    unit,
    levelGap,
    x: (u) => left + u * unit,
    y: (depth) => top + depth * levelGap,
  };
}

export function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, colour: string, width = 1) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function arrow(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  colour: string,
  width = 1,
  head = 4,
) {
  line(ctx, a, b, colour, width);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
  ctx.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  lineWidth?: number;
  text?: string;
  textColour: string;
  fontPx: number;
  bold?: boolean;
}

export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  px: number,
  align: CanvasTextAlign = 'center',
  bold = false,
) {
  ctx.font = font(px, bold);
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function disc(ctx: CanvasRenderingContext2D, at: Point, r: number, style: NodeStyle) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1;
  ctx.stroke();
  if (style.text !== undefined) {
    label(ctx, style.text, at.x, at.y + 0.5, style.textColour, style.fontPx, 'center', style.bold);
  }
}

/** A rectangle centred on `at`, with slightly rounded corners. */
export function plate(
  ctx: CanvasRenderingContext2D,
  at: Point,
  w: number,
  h: number,
  style: NodeStyle,
) {
  ctx.beginPath();
  ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, Math.min(4, h / 4));
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth ?? 1;
  ctx.stroke();
  if (style.text !== undefined) {
    label(ctx, style.text, at.x, at.y + 0.5, style.textColour, style.fontPx, 'center', style.bold);
  }
}

/** The usual look of a node: plain, or outlined and tinted in its role's colour. */
export function roleStyle(palette: Palette, role: Role | undefined, fontPx: number): NodeStyle {
  const colour = roleColour(palette, role);
  return {
    fill: colour ? tint(palette, colour, role === 'visit' ? 0.55 : 0.3) : palette.bg,
    stroke: colour && role !== 'visit' ? colour : palette.muted,
    lineWidth: colour && role !== 'visit' ? 2 : 1,
    textColour: palette.ink,
    fontPx,
  };
}

export interface Cell {
  /** Stable id of the value, so it glides when it changes cell. Omit for fixed text. */
  id?: string | number;
  text: string;
  role?: Role;
  /** Small label under the cell, usually its index. */
  sub?: string;
  /** Draw the value faintly (a tombstone, an unused slot). */
  dim?: boolean;
}

export interface CellGrid {
  /** Centre of cell i. */
  at(i: number): Point;
  cell: number;
  rows: number;
  /** Total height used, including the labels. */
  height: number;
}

/** Works out a grid of square-ish cells for `count` items in a strip `width` wide, wrapping when cramped. */
export function cellGrid(
  count: number,
  box: Box,
  minCell = 19,
  maxCell = 34,
  subLabels = true,
): CellGrid {
  const n = Math.max(1, count);
  let rows = 1;
  while (box.w / Math.ceil(n / rows) < minCell && rows < 6) rows++;
  const perRow = Math.ceil(n / rows);
  const sub = subLabels ? 12 : 0;
  const cell = Math.min(maxCell, box.w / perRow, (box.h - rows * sub) / rows);
  const rowHeight = cell + sub;
  const left = box.x + (box.w - perRow * cell) / 2;
  return {
    cell,
    rows,
    height: rows * rowHeight,
    at: (i) => ({
      x: left + ((i % perRow) + 0.5) * cell,
      y: box.y + Math.floor(i / perRow) * rowHeight + cell / 2,
    }),
  };
}

/** Draws an array as a strip of cells with small index labels beneath. */
export function drawCells(g: Gfx, cells: readonly Cell[], grid: CellGrid, key = 'cell') {
  const { ctx, palette } = g;
  const size = grid.cell;
  const px = Math.max(8, Math.min(13, size * 0.48));
  cells.forEach((cell, i) => {
    const at = grid.at(i);
    const colour = roleColour(palette, cell.role);
    ctx.fillStyle = colour ? tint(palette, colour, cell.role === 'visit' ? 0.55 : 0.3) : palette.bg;
    ctx.fillRect(at.x - size / 2, at.y - size / 2, size, size);
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(at.x - size / 2 + 0.5, at.y - size / 2 + 0.5, size - 1, size - 1);
    if (cell.sub !== undefined) {
      label(ctx, cell.sub, at.x, at.y + size / 2 + 6.5, palette.muted, Math.min(10, px));
    }
  });
  // Outlines of highlighted cells go on top of their neighbours' borders.
  cells.forEach((cell, i) => {
    const colour = roleColour(palette, cell.role);
    if (!colour || cell.role === 'visit') return;
    const at = grid.at(i);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.strokeRect(at.x - size / 2 + 1, at.y - size / 2 + 1, size - 2, size - 2);
  });
  cells.forEach((cell, i) => {
    if (cell.text === '') return;
    const rest = grid.at(i);
    const at = cell.id === undefined ? rest : g.place(`${key}:${cell.id}`, rest.x, rest.y);
    label(ctx, cell.text, at.x, at.y + 0.5, cell.dim ? palette.muted : palette.ink, px);
  });
}
