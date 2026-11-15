import { packPoints } from '../../core/encode';
import {
  bernstein,
  deBoor,
  deCasteljau,
  knotVector,
  splineDomain,
} from '../../core/geometry/curves';
import { monotoneChain } from '../../core/geometry/hull';
import { WORLD_H, WORLD_W, toUnit } from '../../core/geometry/plane';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clampInt, dot, pointEditor, worldView } from './points';
import { FONT, SMALL } from '../../ui/font';

/** Playback moves t in this many equal steps from 0 to 1. */
const T_STEPS = 200;
const MAX_CONTROL = 9;

const MODES = [
  { id: 'bezier', name: 'Bézier (de Casteljau)' },
  { id: 'bspline', name: 'B-spline (de Boor)' },
] as const;
type Mode = (typeof MODES)[number]['id'];

const at = (x: number, y: number): Point => ({ x: x * WORLD_W, y: y * WORLD_H });
const PRESETS: Record<string, Point[]> = {
  Arch: [at(0.1, 0.8), at(0.25, 0.15), at(0.7, 0.12), at(0.9, 0.78)],
  Wave: [at(0.06, 0.5), at(0.2, 0.1), at(0.38, 0.9), at(0.55, 0.1), at(0.72, 0.9), at(0.94, 0.5)],
  Loop: [at(0.15, 0.75), at(0.9, 0.2), at(0.5, 0.05), at(0.1, 0.2), at(0.85, 0.75)],
  Spiral: [
    at(0.5, 0.5),
    at(0.62, 0.42),
    at(0.6, 0.7),
    at(0.36, 0.68),
    at(0.3, 0.28),
    at(0.7, 0.16),
    at(0.9, 0.55),
    at(0.7, 0.9),
    at(0.2, 0.88),
  ],
};

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A curve with its control polygon and the nested interpolation lines that construct one point on it.',
  );
  const url = urlState({
    mode: 'bezier',
    pts: packPoints(PRESETS.Arch.map(toUnit)),
    degree: 3,
    clamped: true,
    t: 0.4,
    lines: true,
    hull: true,
    speed: 30,
    // Unused by this demo's editor, which has no random set.
    seed: 0,
    dist: '',
    n: 4,
  });
  const settings = url.state;
  settings.degree = clampInt(settings.degree, 1, 5);
  settings.t = Math.max(0, Math.min(1, Number.isFinite(settings.t) ? settings.t : 0.4));
  const mode = (): Mode => MODES.find((m) => m.id === settings.mode)?.id ?? 'bezier';

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 5,
    maxSpeed: 200,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(position) {
      settings.t = position / T_STEPS;
      url.save();
      update();
    },
  });
  const degreeSlider = slider({
    label: 'B-spline degree',
    min: 1,
    max: 5,
    value: settings.degree,
    onInput(value) {
      settings.degree = value;
      url.save();
      update();
    },
  });
  const clampedBox = checkbox({
    label: 'Clamped knots (reach the end points)',
    checked: settings.clamped,
    onChange(on) {
      settings.clamped = on;
      url.save();
      update();
    },
  });
  const editor = pointEditor({
    canvas,
    stage,
    settings,
    save: url.save,
    max: MAX_CONTROL,
    min: 2,
    onChange: () => update(),
    redraw: () => draw(),
    extra: [
      el(
        'div',
        { class: 'buttons' },
        ...Object.entries(PRESETS).map(([name, points]) => button(name, () => editor.set(points))),
      ),
    ],
  });
  if (editor.points.length < 2) editor.points = [...PRESETS.Arch];

  /** The spline's degree cannot exceed the number of control points less one. */
  const splineDegree = () => Math.min(settings.degree, editor.points.length - 1);

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = worldView(stage);
    const control = editor.points;
    const t = settings.t;
    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const polyline = (points: readonly Point[], close = false) => {
      ctx.beginPath();
      points.forEach((p, k) =>
        k ? ctx.lineTo(view.x(p.x), view.y(p.y)) : ctx.moveTo(view.x(p.x), view.y(p.y)),
      );
      if (close) ctx.closePath();
    };

    let levels: Point[][];
    let activeFrom = 0;
    let activeTo = control.length - 1;

    if (mode() === 'bezier') {
      levels = deCasteljau(control, t);
      const sample = (to: number) =>
        Array.from({ length: 101 }, (_, i) => bernstein(control, (to * i) / 100));
      polyline(sample(1));
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      polyline(sample(t));
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      const degree = splineDegree();
      const knots = knotVector(control.length, degree, settings.clamped);
      const [lo, hi] = splineDomain(knots, control.length, degree);
      const u = Math.min(lo + t * (hi - lo), hi - 1e-9);
      const result = deBoor(control, degree, knots, u);
      levels = result.levels;
      activeFrom = result.span - degree;
      activeTo = result.span;
      // One piece per knot span. Pieces the hovered control point shapes are drawn heavier.
      for (let span = degree; span < control.length; span++) {
        const from = knots[span];
        const to = knots[span + 1];
        if (to <= from) continue;
        const piece = Array.from({ length: 33 }, (_, i) => {
          const v = Math.min(from + ((to - from) * i) / 32, hi - 1e-9);
          return deBoor(control, degree, knots, v).levels[degree][0];
        });
        const local = editor.hot >= span - degree && editor.hot <= span;
        polyline(piece);
        ctx.strokeStyle = palette.series[(span - degree) % 2 === 0 ? 0 : 2];
        ctx.lineWidth = span === result.span || local ? 3.5 : 1.75;
        ctx.stroke();
        dot(ctx, view.x(piece[0].x), view.y(piece[0].y), 2.5, palette.bg, palette.ink);
        if (span === control.length - 1) {
          const end = piece[piece.length - 1];
          dot(ctx, view.x(end.x), view.y(end.y), 2.5, palette.bg, palette.ink);
        }
      }
    }

    if (settings.hull) {
      const active = control.slice(activeFrom, activeTo + 1);
      const hull = monotoneChain(active).hull.map((i) => active[i]);
      polyline(hull, true);
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The control polygon, then each level of interpolation in its own colour.
    polyline(control);
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (settings.lines) {
      levels.forEach((level, r) => {
        if (r === 0 && mode() === 'bezier') return;
        const colour = r === 0 ? palette.ink : palette.series[(r - 1) % palette.series.length];
        if (level.length > 1) {
          polyline(level);
          ctx.strokeStyle = colour;
          ctx.lineWidth = r === 0 ? 1.5 : 1.25;
          ctx.stroke();
        }
        if (r > 0 && r < levels.length - 1) {
          for (const p of level) dot(ctx, view.x(p.x), view.y(p.y), 2.5, colour);
        }
      });
    }

    ctx.font = `${SMALL}px ${FONT}`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    control.forEach((p, i) => {
      const inPlay = i >= activeFrom && i <= activeTo;
      const x = view.x(p.x);
      const y = view.y(p.y);
      dot(ctx, x, y, 5, inPlay ? palette.ink : palette.bg, inPlay ? undefined : palette.muted);
      if (i === editor.hot) dot(ctx, x, y, 8, 'transparent', palette.accent);
      ctx.fillStyle = palette.muted;
      ctx.fillText(`P${i}`, x + 7, y - 4);
    });
    const [point] = levels[levels.length - 1];
    dot(ctx, view.x(point.x), view.y(point.y), 5, palette.change, palette.bg);
  }

  function update() {
    const count = editor.points.length;
    const bezier = mode() === 'bezier';
    const degree = bezier ? count - 1 : splineDegree();
    degreeSlider.root.hidden = bezier;
    clampedBox.hidden = bezier;
    draw();
    let span = '–';
    if (!bezier) {
      const knots = knotVector(count, degree, settings.clamped);
      const [lo, hi] = splineDomain(knots, count, degree);
      const u = Math.min(lo + settings.t * (hi - lo), hi - 1e-9);
      const k = deBoor(editor.points, degree, knots, u).span;
      span = `${k - degree + 1} of ${count - degree}`;
      status.textContent = `u = ${u.toFixed(2)} lies in knot span [${knots[k]}, ${knots[k + 1]}): only P${k - degree} to P${k} matter here. Knots: ${knots.join(' ')}.`;
    } else {
      status.textContent =
        degree === 1
          ? 'Two control points: the curve is the straight line between them.'
          : `Each level joins points ${Math.round(settings.t * 100)}% of the way along the lines of the level before, until one point is left.`;
    }
    counters.set({
      t: settings.t.toFixed(3),
      degree,
      lerps: (degree * (degree + 1)) / 2,
      span,
    });
  }

  const counters = stats({
    t: 't',
    degree: 'Degree',
    lerps: 'Interpolations per point',
    span: 'Knot span',
  });
  const status = el('p', { class: 'note' });
  const toggle = (label: string, key: 'lines' | 'hull') =>
    checkbox({
      label,
      checked: settings[key],
      onChange(on) {
        settings[key] = on;
        url.save();
        draw();
      },
    });

  panel.append(
    fieldset(
      'Curve',
      select<Mode>({
        label: 'Kind',
        options: MODES,
        value: mode(),
        onChange(id) {
          settings.mode = id;
          url.save();
          update();
        },
      }).root,
      degreeSlider.root,
      clampedBox,
      toggle('Construction lines', 'lines'),
      toggle('Convex hull of the points in play', 'hull'),
    ),
    editor.fieldset,
    player.root,
  );
  editor.fieldset.firstElementChild?.replaceChildren('Control points');
  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-change)', 'Point on the curve at t'],
      ['var(--canvas-ink)', 'Control points in play'],
      ['var(--canvas-series-1)', 'First level of interpolation'],
      ['var(--canvas-series-2)', 'Second level'],
      ['var(--canvas-series-3)', 'Third level'],
    ]),
  );
  about.append(
    prose(
      'A Bézier curve is defined by its control points, and de Casteljau gives a way to draw it with nothing but straight-line interpolation. Slide a point along each side of the control polygon by the same fraction `t`, join those points, and repeat on the new, shorter polygon. The last point left is on the curve.',
    ),
    formula(
      'P[i](r) = (1 − t) P[i](r−1) + t P[i+1](r−1)          de Casteljau, r = 1 .. n\nB(t)   = Σ C(n, i) tⁱ (1 − t)ⁿ⁻ⁱ P[i]                 the same point, Bernstein form\ncost: n(n + 1)/2 interpolations for degree n',
    ),
    prose(
      'Every Bézier control point pulls on the whole curve, and the degree grows with the number of points. A B-spline keeps the degree fixed and stitches pieces together at knots. De Boor’s algorithm is the same nested interpolation, but on only `degree + 1` neighbouring control points, with fractions taken from the knot values.',
    ),
    prose(
      'That gives local control: hover or drag a control point and the pieces it shapes are drawn heavier; the rest of the curve does not move. Each piece stays inside the convex hull of its own control points, the shaded region. With clamped knots and no interior knots (degree equal to the number of points less one) the B-spline is exactly the Bézier curve.',
    ),
  );

  player.setLength(T_STEPS, Math.round(settings.t * T_STEPS));

  return () => {
    player.dispose();
    editor.dispose();
    stage.dispose();
    theme.dispose();
  };
};
