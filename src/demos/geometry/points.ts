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

/** Numbers the points p1, p2, ... when there are few enough to read. */
export function labelPoints(
  ctx: CanvasRenderingContext2D,
  view: View,
  points: readonly Point[],
  colour: string,
  limit = 30,
  prefix = '',
): void {
  if (points.length > limit) return;
  ctx.font = `${SMALL}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  // At the small size, numbers of close points would run into each other, so each one takes
  // the first free place around its point (above right, then the other corners and sides).
  type Rect = [number, number, number, number];
  const taken: Rect[] = points.map((p) => {
    const x = view.x(p.x);
    const y = view.y(p.y);
    return [x - 4, y - 4, x + 4, y + 4];
  });
  const clear = (r: Rect) =>
    taken.every((t) => r[2] <= t[0] || r[0] >= t[2] || r[3] <= t[1] || r[1] >= t[3]);
  const h = SMALL;
  points.forEach((p, i) => {
    const text = `${prefix}${i + 1}`;
    const w = ctx.measureText(text).width;
    const x = view.x(p.x);
    const y = view.y(p.y);
    const spots: [number, number][] = [
      [x + 5, y - h - 2],
      [x - 5 - w, y - h - 2],
      [x + 5, y + 2],
      [x - 5 - w, y + 2],
      [x + 7, y - h / 2],
      [x - 7 - w, y - h / 2],
      [x - w / 2, y - h - 6],
      [x - w / 2, y + 6],
    ];
    const spot = spots.find(([sx, sy]) => clear([sx, sy, sx + w, sy + h])) ?? spots[0];
    taken.push([spot[0], spot[1], spot[0] + w, spot[1] + h]);
    ctx.fillText(text, spot[0], spot[1]);
  });
  ctx.textBaseline = 'alphabetic';
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
