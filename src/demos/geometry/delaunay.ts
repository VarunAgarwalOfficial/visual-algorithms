import {
  GHOST,
  circumcircle,
  delaunay,
  realTriangles,
  voronoiCells,
  type DelaunayStep,
} from '../../core/geometry/delaunay';
import { createStage } from '../../ui/canvas';
import { checkbox, el, fieldset } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { dot, dotRadius, labelPoints, pointEditor, worldView } from './points';
import { drawHint } from '../../ui/font';

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Points joined into a Delaunay triangulation, with the Voronoi diagram as an option.',
  );
  const url = urlState({
    pts: '',
    seed: 21,
    dist: 'uniform',
    n: 16,
    tri: true,
    voronoi: false,
    circles: false,
    speed: 3,
  });
  const settings = url.state;

  let steps: DelaunayStep[] = [];
  let step: DelaunayStep | undefined;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 60,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(position) {
      step = position > 0 ? steps[position - 1] : undefined;
      update();
    },
  });
  const editor = pointEditor({
    canvas,
    stage,
    settings,
    save: url.save,
    max: 80,
    maxRandom: 60,
    distributions: ['uniform', 'cluster', 'circle', 'jitter', 'grid'],
    onChange: (reason) => retrace(reason === 'edit'),
    redraw: () => draw(),
  });

  function retrace(live: boolean) {
    steps = [];
    delaunay(editor.points, steps);
    player.setLength(steps.length, live ? steps.length : 0);
    url.save();
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = worldView(stage);
    const points = editor.points;
    const px = (i: number) => view.x(points[i].x);
    const py = (i: number) => view.y(points[i].y);
    ctx.clearRect(0, 0, width, height);
    if (points.length === 0) {
      drawHint(ctx, width, height, palette.muted, 'Click here to add points, or press Randomise.');
    }
    ctx.lineJoin = 'round';

    const triangle = (t: readonly number[]) => {
      ctx.beginPath();
      ctx.moveTo(px(t[0]), py(t[0]));
      ctx.lineTo(px(t[1]), py(t[1]));
      ctx.lineTo(px(t[2]), py(t[2]));
      ctx.closePath();
    };
    const circle = (t: readonly number[]) => {
      const c = circumcircle(points[t[0]], points[t[1]], points[t[2]]);
      // A near-flat triangle has a circle too large to draw usefully.
      if (!Number.isFinite(c.r) || c.r * view.scale > 20 * width) return;
      ctx.beginPath();
      ctx.arc(view.x(c.x), view.y(c.y), c.r * view.scale, 0, 2 * Math.PI);
      ctx.stroke();
    };

    const triangles = step?.triangles ?? [];
    const real = realTriangles(triangles);
    const bad = new Set(step?.kind === 'bad' ? step.bad : []);
    const freshFrom = step?.kind === 'fill' ? triangles.length - step.fresh : triangles.length;

    if (settings.circles) {
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      real.forEach(circle);
    }
    if (settings.voronoi && step) {
      // The canvas edge in world units, with a margin so cell borders along it stay out of sight.
      const a = view.world({ x: -20, y: -20 });
      const b = view.world({ x: width + 20, y: height + 20 });
      const cells = voronoiCells(points, step.inserted, triangles, {
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
      });
      ctx.strokeStyle = palette.compare;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const cell of cells.values()) {
        cell.forEach((p, k) =>
          k ? ctx.lineTo(view.x(p.x), view.y(p.y)) : ctx.moveTo(view.x(p.x), view.y(p.y)),
        );
        ctx.closePath();
      }
      ctx.stroke();
      if (settings.tri) {
        for (const t of real) {
          const c = circumcircle(points[t[0]], points[t[1]], points[t[2]]);
          dot(ctx, view.x(c.x), view.y(c.y), 2, palette.compare);
        }
      }
    }

    triangles.forEach((t, index) => {
      const ghost = t[2] === GHOST;
      if (bad.has(index)) {
        if (ghost) return;
        triangle(t);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = palette.change;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = palette.change;
        ctx.lineWidth = 1;
        circle(t);
      } else if (index >= freshFrom && !ghost) {
        triangle(t);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = palette.good;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
    if (settings.tri || (step && step.kind !== 'done')) {
      ctx.strokeStyle = settings.tri ? palette.ink : palette.muted;
      ctx.lineWidth = 1;
      ctx.globalAlpha = settings.tri ? 0.75 : 0.5;
      for (const t of real) {
        triangle(t);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (step && (step.kind === 'bad' || step.kind === 'fill')) {
      // The hole: its real edges, and the spokes from the new point once it is filled.
      ctx.strokeStyle = step.kind === 'bad' ? palette.change : palette.good;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [u, v] of step.cavity) {
        if (u === GHOST || v === GHOST) continue;
        ctx.moveTo(px(u), py(u));
        ctx.lineTo(px(v), py(v));
      }
      ctx.stroke();
      if (step.kind === 'fill') {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const ends = new Set(step.cavity.flat().filter((i) => i !== GHOST));
        for (const i of ends) {
          ctx.moveTo(px(step.point), py(step.point));
          ctx.lineTo(px(i), py(i));
        }
        ctx.stroke();
      }
    }

    const radius = dotRadius(stage, points.length);
    const inserted = new Set(step ? step.inserted : points.map((_, i) => i));
    points.forEach((_, i) => {
      if (i === step?.point) dot(ctx, px(i), py(i), radius + 1, palette.compare, palette.ink);
      else if (inserted.has(i)) dot(ctx, px(i), py(i), radius, palette.ink);
      else dot(ctx, px(i), py(i), radius - 1, palette.bg, palette.muted);
      if (i === editor.hot) dot(ctx, px(i), py(i), radius + 3, 'transparent', palette.accent);
    });
    labelPoints(ctx, view, points, palette.muted, {
      limit: 24,
      halo: palette.bg,
      radius: radius + 1,
    });
  }

  function update() {
    draw();
    counters.set({
      inserted: step ? step.inserted.length : 0,
      triangles: step ? realTriangles(step.triangles).length : 0,
      removed:
        step?.kind === 'bad' ? step.bad.filter((i) => step?.triangles[i][2] !== GHOST).length : 0,
    });
    status.textContent = step
      ? step.note
      : `Nothing has run yet: ${editor.points.length} points. Press Play to join them into triangles one point at a time, or drag a point to move it.`;
  }

  const counters = stats({
    inserted: 'Points inserted',
    triangles: 'Triangles',
    removed: 'Removed this step',
  });
  const status = el('p', { class: 'note' });
  const toggle = (label: string, key: 'tri' | 'voronoi' | 'circles') =>
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
      'Show',
      toggle('Delaunay triangles', 'tri'),
      toggle('Voronoi diagram (the dual)', 'voronoi'),
      toggle('Circumcircles', 'circles'),
    ),
    editor.fieldset,
    player.root,
  );
  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-compare)', 'Point being inserted, Voronoi edges'],
      ['var(--canvas-change)', 'Triangles whose circumcircle holds it'],
      ['var(--canvas-good)', 'New triangles'],
    ]),
  );
  about.append(
    prose(
      'A Delaunay triangulation joins points so that no point lies inside the circle through the corners of any triangle. Of all triangulations it avoids thin slivers best: it makes the smallest angle as large as it can be.',
    ),
    prose(
      'Bowyer-Watson adds one point at a time. Every triangle whose circumcircle contains the new point is no longer allowed, so those are removed. They always form one star-shaped hole around the point, and joining the point to each edge of the hole restores the property. When the point falls outside the hull, the hull edges that face it play the part of the removed triangles.',
    ),
    formula(
      'triangles = 2n − 2 − h      edges = 3n − 3 − h      (n points, h of them on the hull)\ncost: O(n²) as written here (every triangle is tested), O(n log n) with point location',
    ),
    prose(
      'The Voronoi diagram is the dual: each cell is the region nearer to its point than to any other. Its corners are the circumcentres of the triangles, and two cells share an edge exactly when their points share a Delaunay edge. Turn on the circumcircles and drag a point: an edge flips at the moment four points lie on one circle. Points are on a whole-number lattice, so that tie is detected exactly; try the exact grid, where every square is such a tie and either diagonal is valid.',
    ),
  );

  retrace(false);

  return () => {
    player.dispose();
    editor.dispose();
    stage.dispose();
    theme.dispose();
  };
};
