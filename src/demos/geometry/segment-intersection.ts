import { packPoints, unpackPoints } from '../../core/encode';
import { WORLD_H, WORLD_W, snap, toUnit, toWorld } from '../../core/geometry/plane';
import {
  randomSegments,
  sweepIntersections,
  type Segment,
  type SweepResult,
  type SweepStep,
} from '../../core/geometry/sweep';
import type { Point } from '../../core/point';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, slider } from '../../ui/dom';
import { onDrag } from '../../ui/pointer';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clampInt, dot, worldView } from './points';
import { FONT, SMALL } from '../../ui/font';

const MAX_SEGMENTS = 24;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Line segments with a vertical sweep line moving across them and their intersections marked.',
  );
  const url = urlState({ seg: '', seed: 8, n: 9, speed: 3 });
  const settings = url.state;
  settings.n = clampInt(settings.n, 2, MAX_SEGMENTS);
  settings.seed = clampInt(settings.seed, 0, 0xffffffff);

  /** Endpoints in pairs: segment i is ends[2i], ends[2i + 1]. */
  let ends: Point[] = [];
  let segments: Segment[] = [];
  let result: SweepResult = sweepIntersections([]);
  let step: SweepStep | undefined;
  let grabbed = -1;
  let hot = -1;
  let removeMode = false;

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
      step = position > 0 ? result.steps[position - 1] : undefined;
      update();
    },
  });

  function generate() {
    const made = randomSegments(settings.n, seeded(settings.seed), WORLD_W, WORLD_H, snap);
    ends = made.flatMap((s) => [s.a, s.b]);
  }

  function retrace(live: boolean) {
    segments = [];
    for (let i = 0; i + 1 < ends.length; i += 2) {
      const a = ends[i];
      const b = ends[i + 1];
      // A segment still being drawn may have no length yet.
      if (a.x !== b.x || a.y !== b.y) segments.push({ a, b });
    }
    result = sweepIntersections(segments);
    player.setLength(result.steps.length, live ? result.steps.length : 0);
  }

  function edited() {
    settings.seg = ends.length ? packPoints(ends.map(toUnit)) : '-';
    url.save();
    retrace(true);
  }

  // --- Pointer: drag on empty space to draw, drag an end to move it ---

  const reach = () => (stage.width < 420 ? 16 : 11);
  function nearestEnd(at: Point): number {
    const view = worldView(stage);
    let best = -1;
    let bestDistance = reach();
    ends.forEach((p, i) => {
      const d = Math.hypot(view.x(p.x) - at.x, view.y(p.y) - at.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }
  function removeSegment(end: number) {
    if (end < 0) return;
    const first = end - (end % 2);
    ends = ends.filter((_, i) => i !== first && i !== first + 1);
    hot = -1;
    edited();
  }
  const stopDrag = onDrag(canvas, {
    down(at) {
      const index = nearestEnd(at);
      if (removeMode) {
        removeSegment(index);
        return false;
      }
      if (index >= 0) {
        grabbed = index;
      } else {
        if (ends.length >= 2 * MAX_SEGMENTS) return false;
        const p = snap(worldView(stage).world(at));
        ends = [...ends, p, p];
        grabbed = ends.length - 1;
      }
      hot = grabbed;
      return true;
    },
    move(at) {
      const p = snap(worldView(stage).world(at));
      ends = ends.map((q, i) => (i === grabbed ? p : q));
      edited();
    },
    up() {
      // Drop a segment that was never given a length.
      const first = grabbed - (grabbed % 2);
      const a = ends[first];
      const b = ends[first + 1];
      grabbed = -1;
      if (a && b && a.x === b.x && a.y === b.y) removeSegment(first);
      else edited();
    },
    hover(at) {
      const index = nearestEnd(at);
      if (index === hot) return;
      hot = index;
      draw();
    },
  });
  const pointAt = (event: MouseEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const onContext = (event: MouseEvent) => {
    event.preventDefault();
    removeSegment(nearestEnd(pointAt(event)));
  };
  const onDouble = (event: MouseEvent) => removeSegment(nearestEnd(pointAt(event)));
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('dblclick', onDouble);

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = worldView(stage);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    const line = (s: Segment) => {
      ctx.beginPath();
      ctx.moveTo(view.x(s.a.x), view.y(s.a.y));
      ctx.lineTo(view.x(s.b.x), view.y(s.b.y));
      ctx.stroke();
    };

    const done = step?.kind === 'done';
    const active = new Set(step?.status);
    const tested = new Set(step?.pair);
    if (step && !done) {
      const x = view.x(step.p.x);
      ctx.fillStyle = palette.faint;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, 0, x, height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    segments.forEach((s, i) => {
      ctx.strokeStyle = tested.has(i)
        ? palette.compare
        : active.has(i)
          ? palette.accent
          : palette.ink;
      ctx.lineWidth = tested.has(i) ? 3 : active.has(i) ? 2.5 : 1.25;
      ctx.globalAlpha = tested.has(i) || active.has(i) || !step || done ? 1 : 0.55;
      line(s);
    });
    ctx.globalAlpha = 1;

    ends.forEach((p, i) => {
      dot(ctx, view.x(p.x), view.y(p.y), 2.5, palette.ink);
      if (i === hot) dot(ctx, view.x(p.x), view.y(p.y), 6, 'transparent', palette.accent);
    });
    if (segments.length <= 16 || width > 500) {
      ctx.font = `${SMALL}px ${FONT}`;
      ctx.fillStyle = palette.muted;
      ctx.textBaseline = 'bottom';
      segments.forEach((s, i) => {
        const left = s.a.x < s.b.x || (s.a.x === s.b.x && s.a.y < s.b.y) ? s.a : s.b;
        ctx.textAlign = 'right';
        ctx.fillText(`s${i + 1}`, view.x(left.x) - 4, view.y(left.y) - 2);
      });
    }

    if (step) {
      for (const p of step.queue) dot(ctx, view.x(p.x), view.y(p.y), 3, palette.bg, palette.muted);
      for (const c of result.crossings.slice(0, step.found)) {
        dot(ctx, view.x(c.p.x), view.y(c.p.y), 4, palette.good);
      }
      if (step.hit) dot(ctx, view.x(step.hit.x), view.y(step.hit.y), 5, palette.bg, palette.change);
      if (!done) dot(ctx, view.x(step.p.x), view.y(step.p.y), 5, 'transparent', palette.compare);
    }
  }

  function update() {
    draw();
    const n = segments.length;
    counters.set({
      segments: n,
      tests: step?.tests ?? 0,
      brute: (n * (n - 1)) / 2,
      found: step?.found ?? 0,
      pairs: step?.pairs ?? 0,
    });
    status.textContent = step
      ? step.note
      : `Nothing has run yet: ${n} line segments. Press Play to sweep a line across them and find where they cross, or drag on the picture to draw another.`;
    order.textContent = step
      ? `Status, top to bottom: ${step.status.map((i) => `s${i + 1}`).join('  ') || 'empty'}. Queue: ${step.queue.length} event${step.queue.length === 1 ? '' : 's'}.`
      : 'Status: empty. Queue: every endpoint.';
  }

  const counters = stats({
    segments: 'Segments',
    tests: 'Pair tests',
    brute: 'Brute force n(n−1)/2',
    found: 'Intersection points',
    pairs: 'Crossing pairs',
  });
  const status = el('p', { class: 'note' });
  const order = el('p', { class: 'note' });

  const randomise = () => {
    generate();
    settings.seg = '';
    url.save();
    retrace(false);
  };
  panel.append(
    fieldset(
      'Segments',
      slider({
        label: 'Random segments',
        min: 2,
        max: MAX_SEGMENTS,
        value: settings.n,
        onInput(value) {
          settings.n = value;
          randomise();
        },
      }).root,
      el(
        'div',
        { class: 'buttons' },
        button('Randomise', () => {
          settings.seed = newSeed();
          randomise();
        }),
        button('Clear', () => {
          ends = [];
          settings.seg = '-';
          url.save();
          retrace(false);
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
        text: `Drag on empty space to draw a segment (up to ${MAX_SEGMENTS}), drag an end to move it, double-click or right-click an end to remove the segment.`,
      }),
    ),
    player.root,
  );
  readout.append(
    counters.root,
    status,
    order,
    legend([
      ['var(--canvas-accent)', 'In the status (cut by the line)'],
      ['var(--canvas-compare)', 'Pair being tested, current event'],
      ['var(--canvas-change)', 'Crossing found ahead, queued'],
      ['var(--canvas-good)', 'Intersection reported'],
      ['var(--canvas-muted)', 'Events waiting (hollow)'],
    ]),
  );
  about.append(
    prose(
      'Testing every pair of `n` segments takes `n(n − 1)/2` tests. The Bentley-Ottmann sweep moves a vertical line from left to right and keeps the segments it cuts in order from top to bottom: the status. Two segments can only cross if they are neighbours in that order just before the crossing, so only new neighbours are tested.',
    ),
    prose(
      'The line stops at events, kept in a queue sorted by x: a segment starts (it joins the status and is tested against the neighbours above and below), a segment ends (its two neighbours become adjacent and are tested), or two segments cross (they swap places and each meets a new neighbour). Crossings found ahead of the line are added to the queue.',
    ),
    formula(
      'events = 2n + k                      (k intersection points)\ntime   = O((n + k) log n)            with a balanced tree for the status\nbrute force = n(n − 1)/2 pair tests  regardless of k',
    ),
    prose(
      'With few crossings the sweep tests far fewer pairs. With many it can test more than brute force, because a pair may become neighbours again and again. This version handles vertical segments, shared endpoints, an endpoint lying on another segment and several segments through one point. It does not report parallel pairs, so collinear segments that overlap or touch end to end are ignored. The status here is a plain sorted list, which is fine for a couple of dozen segments.',
    ),
  );

  if (settings.seg === '') generate();
  else {
    ends = unpackPoints(settings.seg.slice(0, MAX_SEGMENTS * 10))
      .slice(0, 2 * MAX_SEGMENTS)
      .map(toWorld);
    if (ends.length % 2) ends.pop();
  }
  retrace(false);

  return () => {
    player.dispose();
    stopDrag();
    canvas.removeEventListener('contextmenu', onContext);
    canvas.removeEventListener('dblclick', onDouble);
    stage.dispose();
    theme.dispose();
  };
};
