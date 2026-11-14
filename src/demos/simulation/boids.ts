import {
  countTests,
  createFlock,
  stepFlock,
  visibleNeighbours,
  type BoidParams,
  type Flock,
} from '../../core/sim/boids';
import { buildGrid, createGrid, type SpatialGrid } from '../../core/sim/grid';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { canvasPoint, onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clamp, clampInt, every, fit, meter, oneOf, short, toWorld } from './common';

/** The world is this tall; its width follows the shape of the canvas. */
const WORLD_HEIGHT = 600;
const BASE_WIDTH = 800;
/** Circles as x, y, radius for a world BASE_WIDTH wide. */
const OBSTACLES: readonly number[] = [230, 190, 46, 560, 250, 62, 380, 450, 40];
const POINTER_MODES = ['predator', 'attractor', 'off'] as const;
/** The boid whose neighbourhood is drawn. */
const FOCUS = 0;

interface Saved {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A flock of small triangles moving together over a grid of cells.',
  );

  const url = urlState({
    n: 600,
    sep: 2.5,
    ali: 1,
    coh: 0.8,
    radius: 45,
    fov: 270,
    speed: 120,
    force: 240,
    brute: false,
    grid: true,
    focus: true,
    pointer: 'predator',
    obstacles: false,
    seed: 7,
  });
  const settings = url.state;
  settings.n = clampInt(settings.n, 20, 2000);
  settings.sep = clamp(settings.sep, 0, 3);
  settings.ali = clamp(settings.ali, 0, 3);
  settings.coh = clamp(settings.coh, 0, 3);
  settings.radius = clampInt(settings.radius, 15, 120);
  settings.fov = clampInt(settings.fov, 60, 360);
  settings.speed = clampInt(settings.speed, 40, 240);
  settings.force = clampInt(settings.force, 40, 600);
  settings.pointer = oneOf(settings.pointer, POINTER_MODES);

  let worldWidth = BASE_WIDTH;
  let obstacles: number[] = [];
  let flock: Flock = createFlock(0, worldWidth, WORLD_HEIGHT, seeded(1));
  let grid: SpatialGrid = createGrid(worldWidth, WORLD_HEIGHT, settings.radius);
  let tests = 0;
  /** Pointer position in world units while it is over the canvas. */
  let pointer: { x: number; y: number } | undefined;
  const timer = meter();
  const due = every(120);

  const params = (): BoidParams => ({
    separation: settings.sep,
    alignment: settings.ali,
    cohesion: settings.coh,
    radius: settings.radius,
    fov: (settings.fov * Math.PI) / 180,
    maxSpeed: settings.speed,
    maxForce: settings.force,
    brute: settings.brute,
    pointerMode:
      pointer && settings.pointer !== 'off' ? (settings.pointer === 'predator' ? -1 : 1) : 0,
    pointerX: pointer?.x ?? 0,
    pointerY: pointer?.y ?? 0,
    obstacles: settings.obstacles ? obstacles : [],
  });

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => {
    shapeWorld();
    recount();
    draw();
  });

  /** Makes the world as wide as the canvas is, relative to its height, stretching what is in it. */
  function shapeWorld() {
    const wanted = clamp(Math.round((WORLD_HEIGHT * stage.width) / stage.height), 400, 1600);
    const stretch = wanted / worldWidth;
    worldWidth = wanted;
    for (let i = 0; i < flock.n; i++) flock.x[i] *= stretch;
    flock.width = worldWidth;
    obstacles = OBSTACLES.map((v, k) => (k % 3 === 0 ? (v * worldWidth) / BASE_WIDTH : v));
    grid = createGrid(worldWidth, WORLD_HEIGHT, settings.radius);
  }

  function reset() {
    shapeWorld();
    flock = createFlock(settings.n, worldWidth, WORLD_HEIGHT, seeded(settings.seed));
    grid = createGrid(worldWidth, WORLD_HEIGHT, settings.radius);
    timer.reset();
    recount();
    player?.clearHistory();
    draw();
  }

  /** Refreshes the test counter without moving the flock, for changes made while paused. */
  function recount() {
    tests = countTests(flock, params(), grid);
  }

  function changed() {
    url.save();
    recount();
    draw();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = fit(stage, worldWidth, WORLD_HEIGHT);
    const s = view.scale;
    const p = params();
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.beginPath();
    ctx.rect(0, 0, worldWidth * s, WORLD_HEIGHT * s);
    ctx.clip();

    const focusOn = settings.focus && flock.n > FOCUS;
    const neighbours = new Uint8Array(flock.n);
    if (focusOn) {
      if (!p.brute) buildGrid(grid, flock.x, flock.y, flock.n);
      for (const j of visibleNeighbours(flock, p, grid, FOCUS)) neighbours[j] = 1;
    }

    if (settings.grid && !settings.brute) {
      if (focusOn) {
        // The cells the highlighted boid has to look in.
        const c0 = Math.floor((flock.x[FOCUS] - p.radius) / grid.cellWidth);
        const c1 = Math.floor((flock.x[FOCUS] + p.radius) / grid.cellWidth);
        const r0 = Math.floor((flock.y[FOCUS] - p.radius) / grid.cellHeight);
        const r1 = Math.floor((flock.y[FOCUS] + p.radius) / grid.cellHeight);
        ctx.fillStyle = palette.visit;
        ctx.globalAlpha = 0.45;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const col = ((c % grid.cols) + grid.cols) % grid.cols;
            const row = ((r % grid.rows) + grid.rows) % grid.rows;
            ctx.fillRect(
              col * grid.cellWidth * s,
              row * grid.cellHeight * s,
              grid.cellWidth * s,
              grid.cellHeight * s,
            );
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < grid.cols; c++) {
        const x = Math.round(c * grid.cellWidth * s) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT * s);
      }
      for (let r = 1; r < grid.rows; r++) {
        const y = Math.round(r * grid.cellHeight * s) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(worldWidth * s, y);
      }
      ctx.stroke();
    }

    if (settings.obstacles) {
      ctx.fillStyle = palette.faint;
      ctx.strokeStyle = palette.muted;
      for (let k = 0; k < obstacles.length; k += 3) {
        ctx.beginPath();
        ctx.arc(obstacles[k] * s, obstacles[k + 1] * s, obstacles[k + 2] * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (focusOn) {
      // The perception sector: radius and field of view, drawn at each wrapped copy near an edge.
      const heading = Math.atan2(flock.vy[FOCUS], flock.vx[FOCUS]);
      ctx.strokeStyle = palette.change;
      ctx.lineWidth = 1;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const x = (flock.x[FOCUS] + ox * worldWidth) * s;
          const y = (flock.y[FOCUS] + oy * WORLD_HEIGHT) * s;
          ctx.beginPath();
          if (p.fov < Math.PI * 2 - 1e-6) {
            ctx.moveTo(x, y);
            ctx.arc(x, y, p.radius * s, heading - p.fov / 2, heading + p.fov / 2);
            ctx.closePath();
          } else {
            ctx.arc(x, y, p.radius * s, 0, Math.PI * 2);
          }
          ctx.stroke();
        }
      }
    }

    // Boids, one path per colour.
    const length = Math.max(3.2, 6.5 * s);
    const paint = (colour: string, pick: (i: number) => boolean, size: number) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      for (let i = 0; i < flock.n; i++) {
        if (!pick(i)) continue;
        const speed = Math.hypot(flock.vx[i], flock.vy[i]) || 1;
        const hx = (flock.vx[i] / speed) * size;
        const hy = (flock.vy[i] / speed) * size;
        const x = flock.x[i] * s;
        const y = flock.y[i] * s;
        ctx.moveTo(x + hx, y + hy);
        ctx.lineTo(x - hx * 0.6 - hy * 0.45, y - hy * 0.6 + hx * 0.45);
        ctx.lineTo(x - hx * 0.6 + hy * 0.45, y - hy * 0.6 - hx * 0.45);
        ctx.closePath();
      }
      ctx.fill();
    };
    paint(palette.ink, (i) => !neighbours[i] && !(focusOn && i === FOCUS), length);
    if (focusOn) {
      paint(palette.compare, (i) => neighbours[i] === 1, length * 1.25);
      paint(palette.change, (i) => i === FOCUS, length * 1.6);
    }

    if (pointer && settings.pointer !== 'off') {
      ctx.strokeStyle = settings.pointer === 'predator' ? palette.change : palette.good;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pointer.x * s, pointer.y * s, Math.max(5, 9 * s), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (due(!player?.playing)) {
      const brute = flock.n * (flock.n - 1);
      counters.set({
        boids: short(flock.n),
        tests: short(tests),
        brute: short(brute),
        share: brute > 0 ? `${((100 * tests) / brute).toFixed(1)}%` : '–',
        ms: timer.ms.toFixed(2),
      });
      const seenCount = neighbours.reduce((sum, v) => sum + v, 0);
      status.textContent = settings.brute
        ? `Brute force: every boid measures its distance to all ${flock.n - 1} others.`
        : `Grid of ${grid.cols} × ${grid.rows} cells: each boid only measures the boids filed in the cells its radius touches.${
            focusOn ? ` The highlighted boid sees ${seenCount}.` : ''
          }`;
    }
  }

  // --- Pointer ---

  const place = (event: PointerEvent) => {
    const w = toWorld(fit(stage, worldWidth, WORLD_HEIGHT), canvasPoint(canvas, event));
    pointer = { x: clamp(w.x, 0, worldWidth), y: clamp(w.y, 0, WORLD_HEIGHT) };
    if (!player.playing) draw();
  };
  const leave = () => {
    pointer = undefined;
    if (!player.playing) draw();
  };
  const undrag = onDrag(canvas, {
    down: (_, event) => (place(event), true),
    move: (_, event) => place(event),
    hover: (_, event) => place(event),
    // A finger lifting ends the chase; a mouse stays where it is.
    up: (_, event) => {
      if (event.pointerType !== 'mouse') leave();
    },
  });
  canvas.addEventListener('pointerleave', leave);

  // --- Controls ---

  const counters = stats({
    boids: 'Boids',
    tests: 'Distance tests per step',
    brute: 'Brute force n(n−1)',
    share: 'Share',
    ms: 'Step, ms',
  });
  const status = el('p', { class: 'note' });

  type NumberKey = 'sep' | 'ali' | 'coh' | 'fov' | 'speed' | 'force';
  const rule = (
    label: string,
    key: NumberKey,
    min: number,
    max: number,
    step: number,
    format?: (v: number) => string,
  ) =>
    slider({
      label,
      min,
      max,
      step,
      value: settings[key],
      format,
      onInput(value) {
        settings[key] = value;
        changed();
      },
    }).root;
  type FlagKey = 'brute' | 'grid' | 'focus' | 'obstacles';
  const flag = (label: string, key: FlagKey) =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        timer.reset();
        changed();
      },
    });

  const player = simPlayer<Saved>({
    step(dt) {
      tests = timer.time(() => stepFlock(flock, params(), grid, dt));
    },
    draw,
    snapshot: () => ({
      x: flock.x.slice(),
      y: flock.y.slice(),
      vx: flock.vx.slice(),
      vy: flock.vy.slice(),
    }),
    restore(saved) {
      // A snapshot from before a change of count no longer fits; ignore it.
      if (saved.x.length !== flock.n) return;
      flock.x.set(saved.x);
      flock.y.set(saved.y);
      flock.vx.set(saved.vx);
      flock.vy.set(saved.vy);
      recount();
    },
    history: 120,
    reset,
    ticksPerSecond: 60,
  });

  panel.append(
    fieldset(
      'Neighbour lookup',
      flag('Brute force (no grid)', 'brute'),
      flag('Show grid', 'grid'),
      flag('Highlight one boid', 'focus'),
      slider({
        label: 'Perception radius',
        min: 15,
        max: 120,
        value: settings.radius,
        onInput(value) {
          settings.radius = value;
          grid = createGrid(worldWidth, WORLD_HEIGHT, value);
          changed();
        },
      }).root,
      rule('Field of view', 'fov', 60, 360, 10, (v) => `${v}°`),
    ),
    fieldset(
      'Rules',
      rule('Separation', 'sep', 0, 3, 0.1),
      rule('Alignment', 'ali', 0, 3, 0.1),
      rule('Cohesion', 'coh', 0, 3, 0.1),
      rule('Max speed', 'speed', 40, 240, 5),
      rule('Max force', 'force', 40, 600, 10),
    ),
    fieldset(
      'Flock',
      slider({
        label: 'Boids',
        min: 20,
        max: 2000,
        step: 20,
        value: settings.n,
        onInput(value) {
          settings.n = value;
          url.save();
          reset();
        },
      }).root,
      select({
        label: 'Pointer acts as',
        options: [
          { id: 'predator', name: 'Predator (boids flee)' },
          { id: 'attractor', name: 'Attractor (boids follow)' },
          { id: 'off', name: 'Nothing' },
        ],
        value: settings.pointer as (typeof POINTER_MODES)[number],
        onChange(value) {
          settings.pointer = value;
          changed();
        },
      }).root,
      flag('Obstacles', 'obstacles'),
      button('Shuffle', () => {
        settings.seed = newSeed();
        url.save();
        reset();
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-change)', 'Highlighted boid and its field of view'],
      ['var(--canvas-compare)', 'Neighbours it can see'],
      ['var(--canvas-visit)', 'Grid cells it searches'],
    ]),
  );

  about.append(
    prose(
      'Each boid follows three rules, using only the boids it can see: steer away from those that are too close (separation), turn to their average heading (alignment), and move towards their average position (cohesion). No boid leads. The flock is what the three rules add up to.',
    ),
    formula(
      'steer(d) = clamp(max_speed · d / |d| − v, max_force)\na = w_sep · steer(Σ −(x_j − x) / |x_j − x|²)\n  + w_ali · steer(Σ v_j)\n  + w_coh · steer(Σ (x_j − x))',
    ),
    prose(
      'The cost is in finding the neighbours. Asking every boid about every other is `n(n−1)` distance tests per step. The grid cuts the plane into cells as wide as the perception radius and files each boid under its cell with a counting sort, which is `O(n)`. A boid then only looks in the cells its radius touches, at most nine. For an even spread that is `O(n)` per step in total.',
    ),
    prose(
      'Switch brute force on and compare the counters: the flock moves exactly the same, only the number of tests changes. A larger radius means larger cells and more boids per cell, so the saving shrinks. The edges wrap round, and so does the grid.',
    ),
  );

  reset();

  return () => {
    undrag();
    canvas.removeEventListener('pointerleave', leave);
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
