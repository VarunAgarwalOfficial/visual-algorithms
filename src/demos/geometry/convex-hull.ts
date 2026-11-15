import {
  HULL_ALGORITHMS,
  convexHull,
  type HullAlgorithm,
  type HullStep,
} from '../../core/geometry/hull';
import { createStage } from '../../ui/canvas';
import { el, fieldset, select } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { dot, dotRadius, labelPoints, pointEditor, worldView } from './points';
import { drawHint } from '../../ui/font';

const NOTES: Record<HullAlgorithm, string> = {
  graham:
    'Sort by angle around the lowest point, then walk the points keeping a stack that only ever turns left. O(n log n), all of it in the sort.',
  monotone:
    'Sort by x, then build the lower and upper hulls with the same left-turn stack. O(n log n), and no angles are needed.',
  quickhull:
    'Take the point farthest from an edge, discard everything inside the triangle, and recurse on the two new edges. O(n log n) on average, O(n²) at worst.',
  wrap: 'From each hull vertex, scan every point for the one with nothing to its right. O(nh) for h hull vertices: good for small hulls, slow for a circle.',
};

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Points in the plane with their convex hull being built step by step.',
  );
  const url = urlState({ alg: 'graham', pts: '', seed: 12, dist: 'uniform', n: 24, speed: 6 });
  const settings = url.state;
  const algorithm = (): HullAlgorithm =>
    HULL_ALGORITHMS.find((a) => a.id === settings.alg)?.id ?? 'graham';

  let steps: HullStep[] = [];
  /** The finished hull, so the point numbers can keep clear of its edges. */
  let finalHull: number[] = [];
  let step: HullStep | undefined;

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
    max: 150,
    maxRandom: 120,
    distributions: ['uniform', 'cluster', 'circle', 'jitter', 'grid'],
    onChange: (reason) => retrace(reason === 'edit'),
    redraw: () => draw(),
  });

  /** Records a new trace. After a pointer edit the finished hull is shown, so dragging is live. */
  function retrace(live: boolean) {
    const result = convexHull(algorithm(), editor.points);
    steps = result.steps;
    finalHull = result.hull;
    caption.textContent = NOTES[algorithm()];
    player.setLength(steps.length, live ? steps.length : 0);
    url.save();
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = worldView(stage);
    const points = editor.points;
    const at = (i: number) => [view.x(points[i].x), view.y(points[i].y)] as const;
    ctx.clearRect(0, 0, width, height);
    if (points.length === 0) {
      drawHint(ctx, width, height, palette.muted, 'Click here to add points, or press Randomise.');
    }
    ctx.lineJoin = 'round';

    const path = (indices: readonly number[], close: boolean) => {
      ctx.beginPath();
      indices.forEach((i, k) => (k ? ctx.lineTo(...at(i)) : ctx.moveTo(...at(i))));
      if (close) ctx.closePath();
    };
    const finished = step !== undefined && step === steps[steps.length - 1] && step.closed;

    if (step) {
      if (step.active && algorithm() === 'graham') {
        // The fan of sorted directions from the pivot.
        ctx.strokeStyle = palette.faint;
        ctx.lineWidth = 1;
        for (const i of step.active) {
          path([step.chain[0], i], false);
          ctx.stroke();
        }
      }
      if (step.closed && step.chain.length > 2) {
        path(step.chain, true);
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = finished ? palette.good : palette.accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (step.done) {
        path(step.done, false);
        ctx.strokeStyle = palette.good;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      path(step.chain, step.closed);
      ctx.strokeStyle = finished ? palette.good : palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (step.turn) {
        const { a, b, c, keep } = step.turn;
        const colour = keep ? palette.compare : palette.change;
        path([a, b, c], true);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.globalAlpha = 1;
        path([a, b, c], false);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const radius = dotRadius(stage, points.length);
    const dropped = new Set(step?.dropped);
    const onChain = new Set([...(step?.chain ?? []), ...(step?.done ?? [])]);
    const active = new Set(algorithm() === 'quickhull' ? step?.active : []);
    points.forEach((_, i) => {
      const [x, y] = at(i);
      if (dropped.has(i)) dot(ctx, x, y, radius - 1, palette.bg, palette.muted);
      else if (onChain.has(i)) dot(ctx, x, y, radius, finished ? palette.good : palette.accent);
      else if (active.has(i)) dot(ctx, x, y, radius, palette.visit, palette.ink);
      else dot(ctx, x, y, radius, palette.ink);
      if (i === editor.hot) dot(ctx, x, y, radius + 3, 'transparent', palette.accent);
    });
    if (step?.turn) {
      const colour = step.turn.keep ? palette.compare : palette.change;
      for (const i of [step.turn.a, step.turn.b, step.turn.c]) dot(ctx, ...at(i), radius, colour);
    }
    // The numbers keep clear of the finished hull's edges, and are outlined in the page colour so
    // the lines of a step in progress pass behind them.
    const edges = finalHull.map(
      (a, k) => [points[a], points[finalHull[(k + 1) % finalHull.length]]] as const,
    );
    labelPoints(ctx, view, points, palette.muted, { halo: palette.bg, avoid: edges, radius });
  }

  function update() {
    draw();
    counters.set({
      points: editor.points.length,
      tests: step?.tests ?? 0,
      hull: step ? step.chain.length + Math.max(0, (step.done?.length ?? 0) - 1) : 0,
    });
    const cross = step?.turn ? ` Cross product = ${step.turn.cross}.` : '';
    status.textContent = step
      ? step.note + cross
      : `Nothing has run yet: ${editor.points.length} points. Press Play to wrap the outermost points in a boundary, or Step forward to go one step at a time.`;
    // The stack (or the polygon so far), bottom first; a long one shows its top end.
    const chain = step?.chain ?? [];
    const names = chain.slice(-14).map((i) => `p${i + 1}`);
    stack.textContent = !step
      ? 'Stack: empty.'
      : `${step.closed ? 'Polygon' : 'Stack, bottom to top'}: ${chain.length > 14 ? '… ' : ''}${names.join(' ') || 'empty'}.`;
  }

  const counters = stats({ points: 'Points', tests: 'Orientation tests', hull: 'On hull so far' });
  const status = el('p', { class: 'note' });
  const stack = el('p', { class: 'note' });
  const caption = el('p', { class: 'note' });

  panel.append(
    fieldset(
      'Algorithm',
      select<HullAlgorithm>({
        label: 'Method',
        options: HULL_ALGORITHMS,
        value: algorithm(),
        onChange(id) {
          settings.alg = id;
          retrace(false);
        },
      }).root,
      caption,
    ),
    editor.fieldset,
    player.root,
  );
  readout.append(
    counters.root,
    status,
    stack,
    legend([
      ['var(--canvas-accent)', 'Hull so far', 'dot'],
      ['var(--canvas-compare)', 'Turn tested, kept', 'dot'],
      ['var(--canvas-change)', 'Turn tested, rejected', 'dot'],
      ['var(--canvas-muted)', 'Popped or discarded (hollow)', 'hollow'],
      ['var(--canvas-good)', 'Finished', 'dot'],
    ]),
  );
  about.append(
    prose(
      'The convex hull is the smallest convex polygon that contains every point: a rubber band snapped around them. All four methods here rest on one test, whether three points turn left, turn right or lie on a line.',
    ),
    formula(
      'cross(a, b, c) = (b.x − a.x)(c.y − a.y) − (b.y − a.y)(c.x − a.x)      with y measured upwards\n> 0  left turn    < 0  right turn    = 0  collinear',
    ),
    prose(
      'On screen y points down, so the code flips the sign to keep left and right as you see them. The same number is twice the area of the triangle `a b c`, which is why quickhull can use it as a distance from the edge `a b`. Points sit on a whole-number lattice, so the test is exact and collinear points are handled, not guessed: they are left off the hull.',
    ),
    prose(
      'Watch the orientation-test counter. Graham scan and monotone chain spend `O(n log n)` on sorting and then at most `2n` tests in the scan. Gift wrapping costs `n` tests per hull vertex, so put the points on a circle to see it at its worst, and in a Gaussian cluster to see it do well. Quickhull throws away most interior points in its first few steps.',
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
