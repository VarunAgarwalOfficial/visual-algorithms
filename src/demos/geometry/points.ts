import { packPoints, unpackPoints } from '../../core/encode';
import {
  DISTRIBUTIONS,
  WORLD_H,
  WORLD_W,
  dedupe,
  randomPoints,
  snap,
  toUnit,
  toWorld,
  type Distribution,
} from '../../core/geometry/plane';
import type { Point } from '../../core/point';
import { newSeed, seeded } from '../../core/random';
import type { Stage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { onDrag, type DragHandlers } from '../../ui/pointer';
import { FONT, SMALL } from '../../ui/font';

/** Maps the 4:3 lattice world onto the canvas with one scale, centred. */
export interface View {
  scale: number;
  x(worldX: number): number;
  y(worldY: number): number;
  /** Canvas pixels to world coordinates (not snapped). */
  world(p: Point): Point;
}

export function worldView(stage: Stage): View {
  const pad = Math.max(10, Math.min(stage.width, stage.height) * 0.04);
  const scale = Math.min((stage.width - 2 * pad) / WORLD_W, (stage.height - 2 * pad) / WORLD_H);
  const ox = (stage.width - WORLD_W * scale) / 2;
  const oy = (stage.height - WORLD_H * scale) / 2;
  return {
    scale,
    x: (worldX) => ox + worldX * scale,
    y: (worldY) => oy + worldY * scale,
    world: (p) => ({ x: (p.x - ox) / scale, y: (p.y - oy) / scale }),
  };
}

export function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** Point radius that suits the canvas size and the number of points. */
export function dotRadius(stage: Stage, count: number): number {
  const base = stage.width < 420 ? 3 : 4;
  return count > 80 ? base - 1 : base;
}

/** Extra rules for where point numbers may go. */
export interface LabelOptions {
  /** At most this many points are numbered. Default 30. */
  limit?: number;
  prefix?: string;
  /** The number of the first point. Default 1. */
  first?: number;
  /** The page colour: each number gets a thin outline in it, so a line passing behind is cut. */
  halo?: string;
  /** Lines (in world coordinates) the numbers keep clear of where they can, such as a finished hull. */
  avoid?: readonly (readonly [Point, Point])[];
  /** The point radius, so numbers keep clear of the dots. */
  radius?: number;
}

/** Numbers the points p1, p2, ... when there are few enough to read. */
export function labelPoints(
  ctx: CanvasRenderingContext2D,
  view: View,
  points: readonly Point[],
  colour: string,
  options: LabelOptions = {},
): void {
  const { limit = 30, prefix = '', first = 1, halo, avoid = [], radius = 4 } = options;
  if (points.length > limit) return;
  ctx.save();
  ctx.font = `${SMALL}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // At 17px, numbers of close points would run into each other or into the lines, so each one
  // takes the first place around its point that is clear of every dot, every number placed so
  // far (with a gap, so "18" and "7" do not read as one number), the lines to avoid and the
  // canvas edge. Places further out are tried before giving up; with no clear place, the one
  // with the fewest clashes is used.
  type Rect = [number, number, number, number];
  const width = ctx.canvas.clientWidth;
  const height = ctx.canvas.clientHeight;
  const GAP = 3;
  const dots: Rect[] = points.map((p) => {
    const x = view.x(p.x);
    const y = view.y(p.y);
    const r = radius + GAP;
    return [x - r, y - r, x + r, y + r];
  });
  const labels: Rect[] = [];
  const lines = avoid.map(
    ([a, b]) => [view.x(a.x), view.y(a.y), view.x(b.x), view.y(b.y)] as const,
  );
  const meets = (r: Rect, t: Rect) =>
    !(r[2] <= t[0] || r[0] >= t[2] || r[3] <= t[1] || r[1] >= t[3]);
  const crosses = (r: Rect, [x1, y1, x2, y2]: readonly number[]) => {
    // Liang-Barsky clip of the segment against the rectangle.
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const sides: [number, number][] = [
      [-dx, x1 - r[0]],
      [dx, r[2] - x1],
      [-dy, y1 - r[1]],
      [dy, r[3] - y1],
    ];
    for (const [p, q] of sides) {
      if (p === 0) {
        if (q < 0) return false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
      }
    }
    return true;
  };
  const clashes = (r: Rect) => {
    const padded: Rect = [r[0] - GAP, r[1] - GAP, r[2] + GAP, r[3] + GAP];
    let n = 0;
    if (r[0] < 1 || r[1] < 1 || r[2] > width - 1 || r[3] > height - 1) n += 100;
    for (const t of dots) if (meets(r, t)) n += 10;
    for (const t of labels) if (meets(padded, t)) n += 10;
    for (const l of lines) if (crosses(padded, l)) n += 1;
    return n;
  };
  points.forEach((p, i) => {
    const text = `${prefix}${i + first}`;
    const m = ctx.measureText(text);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const x = view.x(p.x);
    const y = view.y(p.y);
    const spots: [number, number][] = [];
    for (const d of [radius + GAP + 1, radius + GAP + 8, radius + GAP + 16]) {
      spots.push(
        [x + d * 0.7, y - d * 0.7 - h],
        [x - d * 0.7 - w, y - d * 0.7 - h],
        [x + d * 0.7, y + d * 0.7],
        [x - d * 0.7 - w, y + d * 0.7],
        [x + d, y - h / 2],
        [x - d - w, y - h / 2],
        [x - w / 2, y - d - h],
        [x - w / 2, y + d],
      );
    }
    let best = spots[0];
    let fewest = Infinity;
    for (const [sx, sy] of spots) {
      const n = clashes([sx, sy, sx + w, sy + h]);
      if (n < fewest) {
        fewest = n;
        best = [sx, sy];
      }
      if (n === 0) break;
    }
    const [sx, sy] = best;
    labels.push([sx, sy, sx + w, sy + h]);
    const bx = sx + m.actualBoundingBoxLeft;
    const by = sy + m.actualBoundingBoxAscent;
    if (halo) {
      ctx.strokeStyle = halo;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, bx, by);
    }
    ctx.fillText(text, bx, by);
  });
  ctx.restore();
}

/** The URL fields the editor reads and writes. `pts` is '' for "generate from the seed". */
export interface PointSettings {
  pts: string;
  seed: number;
  dist: string;
  n: number;
}

export interface PointEditorOptions {
  canvas: HTMLCanvasElement;
  stage: Stage;
  settings: PointSettings;
  save(): void;
  /** Most points allowed, also when read from the URL. */
  max: number;
  /** Fewest points allowed (removing stops here). Default 0. */
  min?: number;
  /** Offered in the Randomise menu; leave out for no random controls. */
  distributions?: readonly Distribution[];
  /** Upper end of the count slider. Default `max`. */
  maxRandom?: number;
  /** The points changed: 'edit' for a pointer edit (possibly mid-drag), 'new' for a whole new set. */
  onChange(reason: 'edit' | 'new'): void;
  /** Hover or selection changed: repaint only. */
  redraw(): void;
  /** When this returns false the pointer is handed to `other` (a query probe, say). */
  enabled?(): boolean;
  other?: DragHandlers;
  /** Extra controls for the fieldset. */
  extra?: (Node | false)[];
}

export interface PointEditor {
  /** World (lattice) coordinates, in insertion order. Replaced, never mutated, on change. */
  points: Point[];
  /** Index under the pointer or being dragged, or -1. */
  readonly hot: number;
  readonly dragging: boolean;
  fieldset: HTMLFieldSetElement;
  set(points: readonly Point[]): void;
  dispose(): void;
}

/** A value from the URL kept inside a range. */
export function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(value) ? value : lo)));
}

/**
 * Click to add a point, drag to move one, double-click or right-click to remove
 * one (or tick "Remove on click", for touch). Points live on the lattice and
 * are saved in the URL: as a seed while untouched, as packed points once edited.
 */
export function pointEditor(options: PointEditorOptions): PointEditor {
  const { canvas, stage, settings, max } = options;
  const min = options.min ?? 0;
  const kinds = options.distributions ?? [];
  const maxRandom = Math.min(max, options.maxRandom ?? max);
  const kind = (): Distribution => kinds.find((k) => k === settings.dist) ?? kinds[0] ?? 'uniform';
  settings.n = clampInt(settings.n, Math.max(min, 3), maxRandom);
  settings.seed = clampInt(settings.seed, 0, 0xffffffff);

  let hot = -1;
  let dragging = false;
  let removeMode = false;

  const generate = () => randomPoints(kind(), settings.n, seeded(settings.seed)).slice(0, max);
  const editor: PointEditor = {
    points:
      settings.pts === ''
        ? generate()
        : dedupe(
            unpackPoints(settings.pts.slice(0, max * 5))
              .slice(0, max)
              .map(toWorld),
          ),
    get hot() {
      return hot;
    },
    get dragging() {
      return dragging;
    },
    fieldset: fieldset('Points'),
    set(points) {
      editor.points = dedupe(points.map(snap)).slice(0, max);
      commit('new');
    },
    dispose() {
      stopDrag();
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('dblclick', onDouble);
    },
  };

  function commit(reason: 'edit' | 'new') {
    settings.pts = editor.points.length ? packPoints(editor.points.map(toUnit)) : '-';
    options.save();
    options.onChange(reason);
  }

  const enabled = () => options.enabled?.() ?? true;
  const reach = () => (stage.width < 420 ? 16 : 11);

  function nearest(at: Point): number {
    const view = worldView(stage);
    let best = -1;
    let bestDistance = reach();
    editor.points.forEach((p, i) => {
      const d = Math.hypot(view.x(p.x) - at.x, view.y(p.y) - at.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }

  const taken = (p: Point, except: number) =>
    editor.points.some((q, i) => i !== except && q.x === p.x && q.y === p.y);

  function remove(index: number) {
    if (index < 0 || editor.points.length <= min) return;
    editor.points = editor.points.filter((_, i) => i !== index);
    hot = -1;
    commit('edit');
  }

  const stopDrag = onDrag(canvas, {
    down(at, event) {
      if (!enabled()) return options.other?.down?.(at, event);
      const index = nearest(at);
      if (removeMode) {
        remove(index);
        return false;
      }
      if (index >= 0) {
        hot = index;
      } else {
        const p = snap(worldView(stage).world(at));
        if (editor.points.length >= max || taken(p, -1)) return false;
        editor.points = [...editor.points, p];
        hot = editor.points.length - 1;
        commit('edit');
      }
      dragging = true;
      options.redraw();
      return true;
    },
    move(at, event) {
      if (!dragging) return options.other?.move?.(at, event);
      const p = snap(worldView(stage).world(at));
      const current = editor.points[hot];
      if ((p.x === current.x && p.y === current.y) || taken(p, hot)) return;
      editor.points = editor.points.map((q, i) => (i === hot ? p : q));
      commit('edit');
    },
    up(at, event) {
      if (!dragging) return options.other?.up?.(at, event);
      dragging = false;
      options.onChange('edit');
    },
    hover(at, event) {
      if (!enabled()) return options.other?.hover?.(at, event);
      const index = nearest(at);
      if (index === hot) return;
      hot = index;
      options.redraw();
    },
  });

  const onContext = (event: MouseEvent) => {
    event.preventDefault();
    if (!enabled()) return;
    const box = canvas.getBoundingClientRect();
    remove(nearest({ x: event.clientX - box.left, y: event.clientY - box.top }));
  };
  const onDouble = (event: MouseEvent) => {
    if (!enabled()) return;
    const box = canvas.getBoundingClientRect();
    remove(nearest({ x: event.clientX - box.left, y: event.clientY - box.top }));
  };
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('dblclick', onDouble);

  const randomise = () => {
    editor.points = generate();
    hot = -1;
    settings.pts = '';
    options.save();
    options.onChange('new');
  };

  editor.fieldset.append(
    ...(kinds.length
      ? [
          select<Distribution>({
            label: 'Distribution',
            options: DISTRIBUTIONS.filter((d) => kinds.includes(d.id)),
            value: kind(),
            onChange(id) {
              settings.dist = id;
              randomise();
            },
          }).root,
          slider({
            label: 'Random points',
            min: Math.max(min, 3),
            max: maxRandom,
            value: settings.n,
            onInput(value) {
              settings.n = value;
              randomise();
            },
          }).root,
        ]
      : []),
    ...(options.extra ?? []).filter((node): node is Node => Boolean(node)),
    el(
      'div',
      { class: 'buttons' },
      kinds.length > 0 &&
        button('Randomise', () => {
          settings.seed = newSeed();
          randomise();
        }),
      min === 0 &&
        button('Clear', () => {
          editor.points = [];
          hot = -1;
          commit('new');
        }),
    ),
    checkbox({
      label: 'Remove on click',
      checked: false,
      onChange(on) {
        removeMode = on;
      },
    }),
    el('p', {
      class: 'note',
      text: `Click to add (up to ${max}), drag to move, double-click or right-click to remove.`,
    }),
  );

  return editor;
}
