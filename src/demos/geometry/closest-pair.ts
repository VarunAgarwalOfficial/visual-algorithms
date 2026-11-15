import { closestPair, type ClosestStep } from '../../core/geometry/closest';
import { WORLD_H } from '../../core/geometry/plane';
import { createStage } from '../../ui/canvas';
import { el } from '../../ui/dom';
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
    'Points split by vertical lines, with the closest pair found so far joined.',
  );
  const url = urlState({ pts: '', seed: 5, dist: 'uniform', n: 28, speed: 5 });
  const settings = url.state;

  let steps: ClosestStep[] = [];
  let step: ClosestStep | undefined;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 200,
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
    max: 120,
    maxRandom: 100,
    distributions: ['uniform', 'cluster', 'circle', 'jitter', 'grid'],
    onChange: (reason) => retrace(reason === 'edit'),
    redraw: () => draw(),
  });

  function retrace(live: boolean) {
    steps = closestPair(editor.points).steps;
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
    const top = view.y(0) - 6;
    const bottom = view.y(WORLD_H) + 6;
    const vertical = (x: number) => {
      ctx.beginPath();
      ctx.moveTo(view.x(x), top);
      ctx.lineTo(view.x(x), bottom);
      ctx.stroke();
    };

    const working = step !== undefined && step.kind !== 'done';
    if (step && working) {
      // The sub-problem in hand: everything outside its x-range is dimmed.
      const half = 5 / view.scale;
      const x0 = view.x(step.x0 - half);
      const x1 = view.x(step.x1 + half);
      ctx.fillStyle = palette.faint;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 0, x0, height);
      ctx.fillRect(x1, 0, width - x1, height);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1;
      ctx.strokeStyle = palette.muted;
      ctx.setLineDash([3, 4]);
      step.splits.slice(0, -1).forEach(vertical);
      ctx.setLineDash([]);
      const line = step.splits[step.splits.length - 1];
      const own = step.kind === 'split' || step.kind === 'strip' || step.strip !== undefined;
      if (line !== undefined && (own || step.kind === 'merged')) {
        if (step.strip && Number.isFinite(step.d)) {
          ctx.fillStyle = palette.compare;
          ctx.globalAlpha = 0.16;
          const left = Math.max(x0, view.x(line - step.d));
          const right = Math.min(x1, view.x(line + step.d));
          ctx.fillRect(left, top, right - left, bottom - top);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.5;
        vertical(line);
      } else if (line !== undefined) {
        ctx.strokeStyle = palette.muted;
        ctx.setLineDash([3, 4]);
        vertical(line);
        ctx.setLineDash([]);
      }
    }

    const join = (pair: readonly [number, number], colour: string, lineWidth: number) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(px(pair[0]), py(pair[0]));
      ctx.lineTo(px(pair[1]), py(pair[1]));
      ctx.stroke();
    };
    if (step?.best) join(step.best, palette.good, 3);
    if (step?.pair) join(step.pair, palette.change, 1.5);

    const radius = dotRadius(stage, points.length);
    const strip = new Set(step?.strip);
    const best = new Set(step?.best);
    const pair = new Set(step?.pair);
    points.forEach((p, i) => {
      const outside = working && step !== undefined && (p.x < step.x0 || p.x > step.x1);
      if (pair.has(i)) dot(ctx, px(i), py(i), radius + 1, palette.change);
      else if (best.has(i)) dot(ctx, px(i), py(i), radius + 1, palette.good);
      else if (strip.has(i)) dot(ctx, px(i), py(i), radius, palette.compare, palette.ink);
      else dot(ctx, px(i), py(i), radius, outside ? palette.muted : palette.ink);
      if (i === editor.hot) dot(ctx, px(i), py(i), radius + 3, 'transparent', palette.accent);
    });
    labelPoints(ctx, view, points, palette.muted, { halo: palette.bg, radius: radius + 1 });
  }

  function update() {
    draw();
    const n = editor.points.length;
    counters.set({
      points: n,
      distances: step?.distances ?? 0,
      brute: (n * (n - 1)) / 2,
      neighbours: step?.neighbours ?? 0,
      best: step?.best ? bestDistance().toFixed(0) : '–',
    });
    status.textContent = step
      ? step.note
      : `Nothing has run yet: ${n} points. Press Play to find the two that are closest together, or Step forward to go one step at a time.`;
  }
  function bestDistance(): number {
    const [i, j] = step?.best ?? [0, 0];
    const a = editor.points[i];
    const b = editor.points[j];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const counters = stats({
    points: 'Points',
    distances: 'Distances computed',
    brute: 'Brute force n(n−1)/2',
    neighbours: 'Most strip neighbours',
    best: 'Best distance',
  });
  const status = el('p', { class: 'note' });

  panel.append(editor.fieldset, player.root);
  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-accent)', 'Split line'],
      ['var(--canvas-compare)', 'Strip within d of the line'],
      ['var(--canvas-change)', 'Pair being measured'],
      ['var(--canvas-good)', 'Closest pair so far'],
    ]),
  );
  about.append(
    prose(
      'To find the two closest points, sort them by x and split the set in half with a vertical line. Solve each half on its own; say the better answer is `d`. The only pairs not yet considered have one point on each side, and such a pair can only beat `d` if both points lie within `d` of the line: the strip.',
    ),
    prose(
      'Inside the strip, walk the points from top to bottom and compare each with the ones below it that are less than `d` lower. A `d` by `2d` box can hold at most eight points that are all at least `d` apart on their own side, so each point is compared with at most seven others, however crowded the strip looks. The counter "Most strip neighbours" shows the largest number met.',
    ),
    formula('T(n) = 2 T(n/2) + O(n)   =>   O(n log n)\nbrute force: n(n − 1)/2 distances'),
    prose(
      'The halves hand back their points sorted by y, and merging those lists gives the strip in order without sorting again. Sets of two or three points are solved directly. Distances are in lattice units: the canvas is 3996 wide. Try a Gaussian cluster, where the strips are crowded, and the exact grid, where many pairs tie.',
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
