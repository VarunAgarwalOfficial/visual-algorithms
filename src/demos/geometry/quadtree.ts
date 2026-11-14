import { WORLD_H, WORLD_W } from '../../core/geometry/plane';
import {
  buildQuadtree,
  nearestQuery,
  rangeQuery,
  treeSize,
  type QuadNode,
  type QueryEvent,
  type Rect,
} from '../../core/geometry/quadtree';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clampInt, dot, dotRadius, pointEditor, worldView } from './points';

const MODES = [
  { id: 'build', name: 'Build: insert the points' },
  { id: 'range', name: 'Range query: drag a rectangle' },
  { id: 'nearest', name: 'Nearest neighbour: move a probe' },
] as const;
type Mode = (typeof MODES)[number]['id'];

const BOX: Rect = { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
const unit = (v: number, fallback: number) =>
  Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Points in a square grid that subdivides where they are dense, with a query highlighted.',
  );
  const url = urlState({
    mode: 'range',
    pts: '',
    seed: 31,
    dist: 'cluster',
    n: 70,
    cap: 4,
    // The query, in fractions of the canvas: a rectangle (x, y, w, h) or a probe at (x, y).
    qx: 0.52,
    qy: 0.3,
    qw: 0.22,
    qh: 0.3,
    speed: 8,
  });
  const settings = url.state;
  settings.cap = clampInt(settings.cap, 1, 8);
  settings.qx = unit(settings.qx, 0.5);
  settings.qy = unit(settings.qy, 0.3);
  settings.qw = unit(settings.qw, 0.2);
  settings.qh = unit(settings.qh, 0.3);
  const mode = (): Mode => MODES.find((m) => m.id === settings.mode)?.id ?? 'range';

  let tree: QuadNode = buildQuadtree([], 0, settings.cap, BOX).root;
  let events: QueryEvent[] = [];
  let position = 0;
  let anchor: Point | undefined;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 200,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      update();
    },
  });

  const queryRect = (): Rect => ({
    x: settings.qx * WORLD_W,
    y: settings.qy * WORLD_H,
    w: settings.qw * WORLD_W,
    h: settings.qh * WORLD_H,
  });
  const probe = (): Point => ({ x: settings.qx * WORLD_W, y: settings.qy * WORLD_H });
  const pointerUnit = (at: Point): Point => {
    const p = worldView(stage).world(at);
    // Three decimals keep the link short.
    const round = (v: number) => Math.round(unit(v, 0) * 1000) / 1000;
    return { x: round(p.x / WORLD_W), y: round(p.y / WORLD_H) };
  };
  const moveProbe = (at: Point) => {
    const p = pointerUnit(at);
    settings.qx = p.x;
    settings.qy = p.y;
    retrace(true);
  };

  const editor = pointEditor({
    canvas,
    stage,
    settings,
    save: url.save,
    max: 200,
    maxRandom: 160,
    distributions: ['uniform', 'cluster', 'circle', 'jitter'],
    onChange: (reason) => retrace(reason === 'edit'),
    redraw: () => draw(),
    enabled: () => mode() === 'build',
    other: {
      down(at) {
        if (mode() === 'nearest') {
          moveProbe(at);
          return true;
        }
        anchor = pointerUnit(at);
        return true;
      },
      move(at) {
        if (mode() === 'nearest' || !anchor) {
          moveProbe(at);
          return;
        }
        const p = pointerUnit(at);
        settings.qx = Math.min(anchor.x, p.x);
        settings.qy = Math.min(anchor.y, p.y);
        settings.qw = Math.round(Math.abs(anchor.x - p.x) * 1000) / 1000;
        settings.qh = Math.round(Math.abs(anchor.y - p.y) * 1000) / 1000;
        retrace(true);
      },
      up() {
        anchor = undefined;
      },
      hover(at) {
        // Follow the pointer only while the finished result is showing, not mid step-through.
        if (mode() === 'nearest' && !player.playing && player.position >= player.length) {
          moveProbe(at);
        }
      },
    },
  });

  /** Records the trace for the current mode. `live` shows the finished result at once. */
  function retrace(live: boolean) {
    const points = editor.points;
    let length: number;
    if (mode() === 'build') {
      length = points.length;
    } else {
      tree = buildQuadtree(points, points.length, settings.cap, BOX).root;
      events = [];
      if (mode() === 'range') rangeQuery(tree, points, queryRect(), events);
      else nearestQuery(tree, points, probe(), events);
      length = events.length;
    }
    hint.textContent =
      mode() === 'build'
        ? 'Click to add points and watch the cells split.'
        : mode() === 'range'
          ? 'Drag on the canvas to draw the query rectangle. Switch to Build to edit the points.'
          : 'Move the pointer (or drag) to place the probe. Switch to Build to edit the points.';
    player.setLength(length, live ? length : 0);
    url.save();
  }

  /** The state of a query after `position` events. */
  function replay() {
    const visited = new Set<QuadNode>();
    const pruned = new Set<QuadNode>();
    const checked = new Set<number>();
    const hits = new Set<number>();
    let best = -1;
    for (const event of events.slice(0, position)) {
      if (event.kind === 'visit') visited.add(event.node);
      else if (event.kind === 'prune') pruned.add(event.node);
      else {
        checked.add(event.point);
        if (event.hit && mode() === 'range') hits.add(event.point);
        if (event.hit && mode() === 'nearest') best = event.point;
      }
    }
    return { visited, pruned, checked, hits, best, current: events[position - 1] };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = worldView(stage);
    const points = editor.points;
    ctx.clearRect(0, 0, width, height);
    const cell = (node: Rect) =>
      [view.x(node.x), view.y(node.y), node.w * view.scale, node.h * view.scale] as const;
    const walk = (node: QuadNode, visit: (node: QuadNode) => void) => {
      visit(node);
      node.children?.forEach((child) => walk(child, visit));
    };
    const radius = dotRadius(stage, points.length);
    const building = mode() === 'build';

    let shown = tree;
    let state: ReturnType<typeof replay> | undefined;
    if (building) shown = buildQuadtree(points, position, settings.cap, BOX).root;
    else state = replay();

    if (state) {
      const { visited, pruned } = state;
      walk(shown, (node) => {
        if (pruned.has(node)) {
          ctx.fillStyle = palette.muted;
          ctx.globalAlpha = 0.22;
          ctx.fillRect(...cell(node));
        } else if (visited.has(node) && !node.children) {
          ctx.fillStyle = palette.visit;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(...cell(node));
        }
      });
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    walk(shown, (node) => {
      if (!node.children) ctx.strokeRect(...cell(node));
    });
    ctx.globalAlpha = 1;

    if (building) {
      const last = points[position - 1];
      if (last) {
        // The leaf that received the newest point.
        let leaf = shown;
        while (leaf.children) {
          leaf = leaf.children.find(
            (c) => last.x >= c.x && last.x < c.x + c.w && last.y >= c.y && last.y < c.y + c.h,
          ) as QuadNode;
          if (!leaf) break;
        }
        if (leaf) {
          ctx.strokeStyle = palette.compare;
          ctx.lineWidth = 2;
          ctx.strokeRect(...cell(leaf));
        }
      }
      points.forEach((p, i) => {
        const x = view.x(p.x);
        const y = view.y(p.y);
        if (i === position - 1) dot(ctx, x, y, radius + 1, palette.compare, palette.ink);
        else if (i < position) dot(ctx, x, y, radius, palette.ink);
        else dot(ctx, x, y, radius - 1, palette.bg, palette.muted);
        if (i === editor.hot) dot(ctx, x, y, radius + 3, 'transparent', palette.accent);
      });
      return;
    }
    if (!state) return;

    const { current } = state;
    if (current && position < events.length) {
      ctx.strokeStyle = current.kind === 'prune' ? palette.ink : palette.compare;
      ctx.lineWidth = 2;
      ctx.strokeRect(...cell(current.node));
    }
    points.forEach((p, i) => {
      const x = view.x(p.x);
      const y = view.y(p.y);
      if (state.hits.has(i) || state.best === i)
        dot(ctx, x, y, radius + 1, palette.good, palette.ink);
      else if (state.checked.has(i)) dot(ctx, x, y, radius, palette.compare);
      else dot(ctx, x, y, radius, palette.ink);
    });

    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    if (mode() === 'range') {
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(...cell(queryRect()));
      ctx.setLineDash([]);
    } else {
      const q = probe();
      const x = view.x(q.x);
      const y = view.y(q.y);
      if (state.best >= 0) {
        const b = points[state.best];
        const r = Math.hypot(b.x - q.x, b.y - q.y) * view.scale;
        ctx.strokeStyle = palette.change;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.moveTo(x, y);
        ctx.lineTo(view.x(b.x), view.y(b.y));
        ctx.stroke();
      }
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.stroke();
    }
  }

  function update() {
    draw();
    const points = editor.points;
    if (mode() === 'build') {
      const built = buildQuadtree(points, position, settings.cap, BOX);
      const size = treeSize(built.root);
      counters.set({
        tree: size.nodes,
        nodes: '–',
        pruned: '–',
        checked: '–',
        brute: points.length,
        found: `depth ${size.depth}`,
      });
      const info = built.last;
      status.textContent = !info
        ? `Ready: ${points.length} points to insert. Press Play or Step.`
        : info.splits > 0
          ? `Point ${position} overfills its cell (more than ${settings.cap}): ${info.splits === 1 ? 'the cell splits' : `it takes ${info.splits} splits`} into quarters, and it lands at depth ${info.depth}.`
          : `Point ${position} goes into a leaf at depth ${info.depth}, which has room.`;
      return;
    }
    const state = replay();
    const done = position >= events.length;
    counters.set({
      tree: treeSize(tree).nodes,
      nodes: state.visited.size,
      pruned: state.pruned.size,
      checked: state.checked.size,
      brute: points.length,
      found:
        mode() === 'range' ? state.hits.size : state.best >= 0 ? `point ${state.best + 1}` : '–',
    });
    const event = state.current;
    if (!event) {
      status.textContent = 'Ready. Press Play or Step to follow the query through the tree.';
    } else if (done) {
      status.textContent =
        mode() === 'range'
          ? `Done: ${state.hits.size} points in the rectangle, after checking ${state.checked.size} of ${points.length}.`
          : `Done: the nearest point was found after checking ${state.checked.size} of ${points.length}.`;
    } else if (event.kind === 'prune') {
      status.textContent =
        mode() === 'range'
          ? `A cell at depth ${event.node.depth} does not touch the rectangle: skip it and everything in it.`
          : `A cell at depth ${event.node.depth} is farther away than the best point so far: skip it and everything in it.`;
    } else if (event.kind === 'visit') {
      status.textContent = event.node.children
        ? `Enter a cell at depth ${event.node.depth} and look at its four quarters${mode() === 'nearest' ? ', nearest first' : ''}.`
        : `Reach a leaf at depth ${event.node.depth} holding ${event.node.points.length} point${event.node.points.length === 1 ? '' : 's'}.`;
    } else {
      status.textContent =
        mode() === 'range'
          ? `Check point ${event.point + 1}: ${event.hit ? 'inside the rectangle.' : 'outside.'}`
          : `Check point ${event.point + 1}: ${event.hit ? 'nearer than anything so far. The search circle shrinks.' : 'not nearer.'}`;
    }
  }

  const counters = stats({
    tree: 'Nodes in tree',
    nodes: 'Nodes visited',
    pruned: 'Subtrees pruned',
    checked: 'Points checked',
    brute: 'Brute force checks',
    found: 'Result',
  });
  const status = el('p', { class: 'note' });
  const hint = el('p', { class: 'note' });

  panel.append(
    fieldset(
      'Quadtree',
      select<Mode>({
        label: 'Mode',
        options: MODES,
        value: mode(),
        onChange(id) {
          settings.mode = id;
          retrace(false);
        },
      }).root,
      slider({
        label: 'Cell capacity',
        min: 1,
        max: 8,
        value: settings.cap,
        onInput(value) {
          settings.cap = value;
          retrace(mode() !== 'build');
        },
      }).root,
      hint,
    ),
    editor.fieldset,
    player.root,
  );
  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-visit)', 'Leaf visited'],
      ['var(--canvas-muted)', 'Pruned without looking inside'],
      ['var(--canvas-compare)', 'Point checked, current cell'],
      ['var(--canvas-good)', 'Result'],
    ]),
  );
  about.append(
    prose(
      'A quadtree divides the plane into four quarters, and any quarter that holds more points than the capacity is divided again. Dense areas end up with small cells and empty areas with large ones. This is the bucket (point-region) form: points live in the leaves.',
    ),
    prose(
      'A range query walks down from the root and skips any cell that does not touch the rectangle, along with everything below it. Only the points in the leaves it reaches are checked. A nearest-neighbour query visits the nearest quarter first and keeps the best distance found; a cell whose nearest edge is farther than that cannot hold a better point and is skipped.',
    ),
    formula(
      'build:   O(n · depth)          depth is about log₄(n / capacity) for evenly spread points\nrange:   O(cells touched + points reported)\nnearest: O(log n) typical, O(n) at worst\nbrute force: n checks for either query',
    ),
    prose(
      'Compare "Points checked" with the brute-force count as you move the query. A small rectangle in an empty corner checks nothing. The saving shrinks as the rectangle grows, and a cluster makes the tree deep: cells stop splitting at depth 9 so that near-coincident points cannot divide forever.',
    ),
  );

  retrace(false);
  if (mode() !== 'build') player.seek(player.length);

  return () => {
    player.dispose();
    editor.dispose();
    stage.dispose();
    theme.dispose();
  };
};
