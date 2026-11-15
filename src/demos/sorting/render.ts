import type { Playback } from '../../core/sorting/trace';
import { isDark, mix, type Palette } from '../../ui/theme';
import { FONT as FAMILY } from '../../ui/font';

export type ViewMode = 'bars' | 'dots' | 'wheel';

export const VIEW_MODES: readonly { id: ViewMode; name: string }[] = [
  { id: 'bars', name: 'Bars' },
  { id: 'dots', name: 'Dots (position against value)' },
  { id: 'wheel', name: 'Colour wheel' },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FONT = `12px ${FAMILY}`;
export const SMALL_FONT = `11px ${FAMILY}`;

/** Series colours used to tint ranges: the ones that are not also the highlight colours. */
const RANGE_SERIES = [0, 2, 4, 5];

/** Whether this trace uses buckets, and so needs the tally strip under the array. */
export function usesBuckets(playback: Playback): boolean {
  return playback.trace.marks.some((mark) => mark.buckets);
}

/** Splits a panel into the array plot and, for bucket sorts, the tally strip below it. */
export function splitRect(rect: Rect, buckets: boolean): { plot: Rect; strip?: Rect } {
  if (!buckets) return { plot: rect };
  const stripHeight = Math.max(22, Math.round(rect.h * 0.24));
  return {
    plot: { ...rect, h: rect.h - stripHeight - 6 },
    strip: { x: rect.x, y: rect.y + rect.h - stripHeight, w: rect.w, h: stripHeight },
  };
}

/** Room kept under the bars for their values, and above them for the word naming the step. */
export const VALUE_ROOM = 15;
export const WORD_ROOM = 15;

/** Whether bars are wide enough to carry their values. */
export const labelsFit = (width: number, n: number) => width / Math.max(1, n) >= 13;

/**
 * Writes each bar's value under it, and over each highlighted bar the word for
 * what the step did to it, so the picture says what the colours mean.
 */
function labelBars(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  plot: Rect,
  array: readonly number[],
  scaleMax: number,
  highlight: (i: number) => string | undefined,
  step: string | undefined,
): void {
  const n = array.length;
  if (!labelsFit(plot.w, n)) return;
  const { slot, unit, bottom } = columns(plot, n, scaleMax);
  const size = Math.min(12, Math.max(9, Math.floor(slot * 0.55)));
  ctx.font = `${size}px ${FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.muted;
  for (let i = 0; i < n; i++) ctx.fillText(String(array[i]), plot.x + (i + 0.5) * slot, bottom + 3);
  if (!step) return;
  const word = { compare: 'compare', swap: 'swap', write: 'write', read: 'read' }[step] ?? step;
  ctx.font = SMALL_FONT;
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < n; i++) {
    const colour = highlight(i);
    if (!colour) continue;
    const x = Math.max(plot.x + 22, Math.min(plot.x + plot.w - 22, plot.x + (i + 0.5) * slot));
    ctx.fillStyle = palette.ink;
    ctx.fillText(word, x, bottom - Math.max(1, array[i] * unit) - 4);
  }
  ctx.textAlign = 'left';
}

/**
 * The plot and tally strip for a playback, leaving room above and below the
 * bars for their labels when the bars are wide enough to carry them.
 */
export function layoutSort(
  rect: Rect,
  playback: Playback,
  mode: ViewMode,
): { plot: Rect; strip?: Rect } {
  const split = splitRect(rect, usesBuckets(playback));
  if (mode !== 'bars' || !labelsFit(split.plot.w, playback.array.length)) return split;
  const { plot } = split;
  return {
    ...split,
    plot: { ...plot, y: plot.y + WORD_ROOM, h: Math.max(10, plot.h - WORD_ROOM - VALUE_ROOM) },
  };
}

/** Where bar or dot `i` sits: used for drawing and for dragging bar heights. */
export function columns(plot: Rect, n: number, scaleMax: number) {
  const slot = plot.w / Math.max(1, n);
  return {
    slot,
    unit: plot.h / Math.max(1, scaleMax),
    bottom: plot.y + plot.h,
    indexAt: (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x - plot.x) / slot))),
    valueAt: (y: number) =>
      Math.max(1, Math.min(scaleMax, Math.round(((plot.y + plot.h - y) / plot.h) * scaleMax))),
  };
}

/** The hue for a value on the colour wheel: one full turn from the smallest to the largest. */
function hue(value: number, scaleMax: number): string {
  const lightness = isDark() ? 62 : 52;
  return `hsl(${Math.round((360 * (value - 1)) / Math.max(1, scaleMax))} 72% ${lightness}%)`;
}

/**
 * Draws the array at the playback's cursor inside `rect`, with the positions
 * touched by the latest step highlighted, the current ranges tinted, and the
 * bucket tallies underneath when the algorithm has any.
 */
export function drawSort(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  rect: Rect,
  playback: Playback,
  mode: ViewMode,
  scaleMax: number,
): void {
  const { array, done } = playback;
  const n = array.length;
  if (n === 0) return;
  const last = done ? undefined : playback.last;
  const { plot, strip } = layoutSort(rect, playback, mode);

  // Which range, if any, each position belongs to.
  const group = new Int8Array(n).fill(-1);
  const ranges = done ? undefined : playback.mark?.ranges;
  ranges?.forEach(([lo, hi], k) => group.fill(k % RANGE_SERIES.length, lo, hi));
  const rangeColours = RANGE_SERIES.map((k) => palette.series[k]);
  const tints = rangeColours.map((colour) => mix(colour, palette.bg, 0.4));

  const highlight = (i: number): string | undefined => {
    if (!last) return undefined;
    if (i !== last.i && !((last.type === 'compare' || last.type === 'swap') && i === last.j)) {
      return undefined;
    }
    return last.type === 'compare' || last.type === 'read' ? palette.compare : palette.change;
  };
  const base = (i: number) =>
    done ? palette.good : group[i] >= 0 ? tints[group[i]] : palette.muted;

  if (mode === 'wheel') {
    drawWheel(
      ctx,
      palette,
      plot,
      array,
      scaleMax,
      highlight,
      group,
      ranges ? rangeColours : undefined,
    );
  } else {
    const { slot, unit, bottom } = columns(plot, n, scaleMax);
    if (mode === 'bars') {
      const gap = slot > 4 ? Math.min(2, slot * 0.15) : 0;
      for (let i = 0; i < n; i++) {
        const height = Math.max(1, array[i] * unit);
        ctx.fillStyle = highlight(i) ?? base(i);
        ctx.fillRect(plot.x + i * slot, bottom - height, Math.max(1, slot - gap), height);
      }
      labelBars(ctx, palette, plot, array, scaleMax, highlight, last?.type);
    } else {
      const radius = Math.max(1.2, Math.min(3.5, slot * 0.4));
      for (let i = 0; i < n; i++) {
        const x = plot.x + (i + 0.5) * slot;
        const y = bottom - array[i] * unit + radius;
        const lit = highlight(i);
        if (lit) {
          // A stem to the baseline keeps a lit dot easy to find.
          ctx.fillStyle = lit;
          ctx.fillRect(x - 0.5, y, 1, bottom - y);
        }
        ctx.fillStyle = lit ?? base(i);
        ctx.beginPath();
        ctx.arc(x, y, lit ? radius + 2 : radius, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.fillStyle = palette.faint;
      ctx.fillRect(plot.x, bottom, plot.w, 1);
    }
  }

  if (strip) drawBuckets(ctx, palette, strip, playback);
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  plot: Rect,
  array: readonly number[],
  scaleMax: number,
  highlight: (i: number) => string | undefined,
  group: Int8Array,
  rangeColours: readonly string[] | undefined,
): void {
  const n = array.length;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const outer = Math.max(4, Math.min(plot.w, plot.h) / 2 - 1);
  const ring = Math.max(2, outer * 0.035);
  const radius = outer * 0.84;
  const turn = (2 * Math.PI) / n;
  const angle = (i: number) => -Math.PI / 2 + i * turn;
  // A hair of overlap hides the seams between wedges.
  const overlap = n > 1 ? 0.004 : 0;

  for (let i = 0; i < n; i++) {
    ctx.fillStyle = hue(array[i], scaleMax);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle(i), angle(i + 1) + overlap);
    ctx.fill();
    if (rangeColours && group[i] >= 0) {
      ctx.strokeStyle = rangeColours[group[i]];
      ctx.lineWidth = ring;
      ctx.beginPath();
      ctx.arc(cx, cy, outer - ring / 2, angle(i), angle(i + 1) + overlap);
      ctx.stroke();
    }
  }
  // Lit wedges stand out past the rim, capped in the highlight colour.
  for (let i = 0; i < n; i++) {
    const lit = highlight(i);
    if (!lit) continue;
    const a0 = angle(i);
    const a1 = angle(i + 1);
    ctx.fillStyle = hue(array[i], scaleMax);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outer * 0.93, a0, a1);
    ctx.fill();
    ctx.strokeStyle = lit;
    ctx.lineWidth = Math.max(3, outer * 0.06);
    ctx.beginPath();
    // At least a few pixels long, so a thin wedge still shows its cap.
    const widen = Math.max(0, 3 / outer - turn / 2);
    ctx.arc(cx, cy, outer * 0.95, a0 - widen, a1 + widen);
    ctx.stroke();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos((a0 + a1) / 2) * radius, cy + Math.sin((a0 + a1) / 2) * radius);
    ctx.stroke();
  }
}

/** The tally of each bucket in the current pass, as a small histogram. */
function drawBuckets(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  strip: Rect,
  playback: Playback,
): void {
  const { buckets, bucketBase } = playback;
  const labelled = strip.h >= 34;
  const barsHeight = strip.h - (labelled ? 13 : 0);
  const baseline = strip.y + barsHeight;
  ctx.fillStyle = palette.faint;
  ctx.fillRect(strip.x, baseline, strip.w, 1);
  const k = buckets.length;
  if (k === 0) return;

  const last = playback.done ? undefined : playback.last;
  const lit = last && last.type !== 'compare' && last.type !== 'swap' ? last.bucket : undefined;
  const slot = strip.w / k;
  const gap = slot > 4 ? Math.min(2, slot * 0.15) : 0;
  const tallest = Math.max(1, ...buckets);
  for (let b = 0; b < k; b++) {
    const height = (buckets[b] / tallest) * (barsHeight - 2);
    if (b === lit) {
      ctx.fillStyle = last?.type === 'read' ? palette.compare : palette.change;
      ctx.fillRect(
        strip.x + b * slot,
        baseline - Math.max(2, height),
        Math.max(1, slot - gap),
        Math.max(2, height),
      );
    } else if (height > 0) {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(strip.x + b * slot, baseline - height, Math.max(1, slot - gap), height);
    }
  }

  if (!labelled) return;
  ctx.font = SMALL_FONT;
  ctx.fillStyle = palette.ink;
  ctx.textBaseline = 'alphabetic';
  const y = strip.y + strip.h - 1;
  if (slot >= 14) {
    ctx.textAlign = 'center';
    for (let b = 0; b < k; b++) ctx.fillText(String(b + bucketBase), strip.x + (b + 0.5) * slot, y);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(`bucket ${bucketBase}`, strip.x, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(bucketBase + k - 1), strip.x + strip.w, y);
  }
  ctx.textAlign = 'left';
}
