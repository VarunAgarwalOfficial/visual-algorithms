import {
  createFluid,
  divergence,
  splat,
  stepFluid,
  velocityAt,
  type Fluid,
  type FluidParams,
} from '../../core/sim/fluid';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clamp, clampInt, every, meter, oneOf, short } from './common';
import { FONT } from '../../ui/font';

const PRESETS = ['jets', 'plume', 'blank'] as const;
const VIEWS = ['dye', 'before', 'after', 'pressure'] as const;
const SIZES = [64, 96, 128, 160] as const;
/** Over-relaxation of the pressure solve. */
const RELAXATION = 1.5;

interface Saved {
  u: Float32Array;
  v: Float32Array;
  dyeA: Float32Array;
  dyeB: Float32Array;
  pressure: Float32Array;
  before: Float32Array;
  time: number;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Coloured dye swirling in a fluid, computed on a grid.',
  );

  const url = urlState({
    preset: 'jets',
    size: 128,
    iter: 30,
    visc: 0,
    diff: 0,
    fade: 0.4,
    buoy: 60,
    view: 'dye',
    arrows: false,
  });
  const settings = url.state;
  settings.preset = oneOf(settings.preset, PRESETS);
  settings.view = oneOf(settings.view, VIEWS);
  settings.size = SIZES.includes(settings.size as (typeof SIZES)[number]) ? settings.size : 128;
  settings.iter = clampInt(settings.iter, 0, 80);
  settings.visc = clamp(settings.visc, 0, 20);
  settings.diff = clamp(settings.diff, 0, 5);
  settings.fade = clamp(settings.fade, 0, 2);
  settings.buoy = clampInt(settings.buoy, 0, 200);

  let fluid: Fluid = createFluid(4, 3);
  let scratch = new Float32Array(12);
  let time = 0;
  let last = { before: 0, after: 0 };
  /** Colour scale of the divergence views; follows the size of the divergence before projection. */
  let divergenceScale = 1;
  /** Each stroke of the pointer uses the other dye. */
  let stroke = 0;
  let previous: Point | undefined;
  const timer = meter();
  const due = every(120);

  const raster = document.createElement('canvas');
  const rasterCtx = raster.getContext('2d');
  let image: ImageData | undefined;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const params = (): FluidParams => ({
    viscosity: settings.visc,
    diffusion: settings.diff,
    fade: settings.fade,
    buoyancy: settings.preset === 'plume' ? settings.buoy : 0,
    iterations: settings.iter,
  });

  function reset() {
    const cols = settings.size;
    const rows = (cols * 3) / 4;
    fluid = createFluid(cols, rows);
    scratch = new Float32Array(cols * rows);
    raster.width = cols;
    raster.height = rows;
    image = rasterCtx?.createImageData(cols, rows);
    time = 0;
    last = { before: 0, after: 0 };
    divergenceScale = 1;
    timer.reset();
    // Start with some dye on screen, so a paused first frame shows what is going on.
    sources(1 / 60, 6);
    player?.clearHistory();
    draw();
  }

  /** The preset's inflow for one tick: dye and a push at fixed spots. */
  function sources(dt: number, strength = 1) {
    const { cols, rows } = fluid;
    const unit = cols / 128;
    const radius = 5 * unit;
    if (settings.preset === 'jets') {
      const push = 520 * unit * dt;
      splat(fluid, cols * 0.08, rows * 0.42, radius, push, 0, 0.5 * strength, 0);
      splat(fluid, cols * 0.92, rows * 0.58, radius, -push, 0, 0, 0.5 * strength);
    } else if (settings.preset === 'plume') {
      // The source sways a little, which is enough to make the column roll up.
      const sway = Math.sin(time * 1.3) * 2.5 * unit;
      splat(fluid, cols * 0.5 + sway, rows - radius * 1.2, radius, 0, 0, 0.45 * strength, 0);
      splat(fluid, cols * 0.5 - sway, rows - radius * 1.2, radius * 0.6, 0, 0, 0, 0.3 * strength);
    }
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { cols, rows } = fluid;
    ctx.clearRect(0, 0, width, height);
    if (!image || !rasterCtx) return;
    const data = image.data;
    const bg = hexToRgb(palette.bg);

    if (settings.view === 'dye') {
      const a = hexToRgb(palette.accent);
      const b = hexToRgb(palette.compare);
      for (let k = 0; k < cols * rows; k++) {
        let wa = Math.min(1, fluid.dyeA[k]);
        let wb = Math.min(1, fluid.dyeB[k]);
        const total = wa + wb;
        if (total > 1) {
          wa /= total;
          wb /= total;
        }
        const rest = 1 - wa - wb;
        data[k * 4] = bg[0] * rest + a[0] * wa + b[0] * wb;
        data[k * 4 + 1] = bg[1] * rest + a[1] * wa + b[1] * wb;
        data[k * 4 + 2] = bg[2] * rest + a[2] * wa + b[2] * wb;
        data[k * 4 + 3] = 255;
      }
    } else {
      // A signed field: one colour for positive, another for negative, fading to the background at zero.
      let field: Float32Array;
      let scale: number;
      if (settings.view === 'pressure') {
        field = fluid.pressure;
        let lo = Infinity;
        let hi = -Infinity;
        let mean = 0;
        for (let k = 0; k < cols * rows; k++) {
          mean += field[k];
          if (field[k] < lo) lo = field[k];
          if (field[k] > hi) hi = field[k];
        }
        mean /= cols * rows;
        scratch.set(field);
        for (let k = 0; k < cols * rows; k++) scratch[k] -= mean;
        field = scratch;
        scale = Math.max(1e-6, hi - mean, mean - lo);
      } else {
        if (settings.view === 'after') {
          divergence(fluid, scratch);
          field = scratch;
        } else {
          field = fluid.before;
        }
        scale = divergenceScale;
      }
      const positive = hexToRgb(palette.change);
      const negative = hexToRgb(palette.series[2]);
      for (let k = 0; k < cols * rows; k++) {
        const t = clamp(field[k] / scale, -1, 1);
        const colour = t >= 0 ? positive : negative;
        const w = Math.sqrt(Math.abs(t));
        data[k * 4] = bg[0] + (colour[0] - bg[0]) * w;
        data[k * 4 + 1] = bg[1] + (colour[1] - bg[1]) * w;
        data[k * 4 + 2] = bg[2] + (colour[2] - bg[2]) * w;
        data[k * 4 + 3] = 255;
      }
    }
    rasterCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(raster, 0, 0, width, height);

    if (settings.arrows) {
      const count = width < 500 ? 16 : 24;
      const spacing = width / count;
      const cellX = width / cols;
      const cellY = height / rows;
      ctx.strokeStyle = palette.ink;
      ctx.fillStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          const velocity = velocityAt(fluid, x / cellX, y / cellY);
          // Cells per second to canvas pixels per second.
          const vx = velocity.x * cellX;
          const vy = velocity.y * cellY;
          const speed = Math.hypot(vx, vy);
          if (speed < 2) continue;
          // Length grows with speed but stays inside its own patch.
          const length = Math.min(spacing * 0.9, speed * 0.06) / speed;
          const tx = x + vx * length;
          const ty = y + vy * length;
          ctx.moveTo(x, y);
          ctx.lineTo(tx, ty);
          ctx.rect(x - 1, y - 1, 2, 2);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (settings.view !== 'dye') {
      const label =
        settings.view === 'before'
          ? 'Divergence before projection'
          : settings.view === 'after'
            ? 'Divergence after projection'
            : 'Pressure';
      ctx.font = `12px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const w = ctx.measureText(label).width;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = palette.bg;
      ctx.fillRect(6, 6, w + 12, 20);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.ink;
      ctx.fillText(label, 12, 10);
    }

    if (due(!player?.playing)) {
      counters.set({
        cells: short(cols * rows),
        passes: short(settings.iter),
        before: last.before.toExponential(2),
        after: last.after.toExponential(2),
        ratio: last.after > 0 ? `${short(Math.round(last.before / last.after))}×` : '–',
        ms: timer.ms.toFixed(2),
      });
      status.textContent = player?.started
        ? settings.iter === 0
          ? 'No projection: the velocity keeps its divergence, so fluid piles up and thins out and the motion dies.'
          : `Advect, then project: ${settings.iter} Gauss-Seidel passes over ${short(cols * rows)} cells cut the mean flow out of a cell from ${last.before.toExponential(1)} to ${last.after.toExponential(1)}.`
        : `Nothing has run yet. The colour is dye floating in still fluid. Press Play, then drag across the picture to stir it and watch the dye carried along.`;
    }
  }

  // --- Pointer: drag to stir and add dye ---

  const toCells = (point: Point): Point => ({
    x: (point.x / stage.width) * fluid.cols,
    y: (point.y / stage.height) * fluid.rows,
  });
  const undrag = onDrag(canvas, {
    down(point) {
      previous = toCells(point);
      stroke++;
      inject(previous, 0, 0);
      return true;
    },
    move(point) {
      const at = toCells(point);
      if (previous) inject(at, at.x - previous.x, at.y - previous.y);
      previous = at;
    },
    up() {
      previous = undefined;
    },
  });

  function inject(at: Point, dx: number, dy: number) {
    const unit = fluid.cols / 128;
    const push = 14;
    const a = stroke % 2 === 1 ? 0.8 : 0;
    splat(
      fluid,
      at.x,
      at.y,
      6 * unit,
      clamp(dx * push, -400, 400),
      clamp(dy * push, -400, 400),
      a,
      0.8 - a,
    );
    if (!player.playing) draw();
  }

  // --- Controls ---

  const counters = stats({
    cells: 'Cells',
    passes: 'Solver passes',
    before: 'Divergence before',
    after: 'Divergence after',
    ratio: 'Reduced',
    ms: 'Step, ms',
  });
  const status = el('p', { class: 'note' });

  type NumberKey = 'iter' | 'visc' | 'diff' | 'fade' | 'buoy';
  const live = (label: string, key: NumberKey, min: number, max: number, step: number) =>
    slider({
      label,
      min,
      max,
      step,
      value: settings[key],
      onInput(value) {
        settings[key] = value;
        url.save();
        draw();
      },
    }).root;

  const player = simPlayer<Saved>({
    step(dt) {
      time += dt;
      sources(dt);
      last = timer.time(() => stepFluid(fluid, params(), dt, RELAXATION));
      // Follow the typical size of the divergence, so the before and after views share one scale.
      let peak = 0;
      for (let k = 0; k < fluid.before.length; k++) {
        const d = Math.abs(fluid.before[k]);
        if (d > peak) peak = d;
      }
      divergenceScale = Math.max(1e-6, divergenceScale * 0.95 + peak * 0.5 * 0.05);
    },
    draw,
    snapshot: () => ({
      u: fluid.u.slice(),
      v: fluid.v.slice(),
      dyeA: fluid.dyeA.slice(),
      dyeB: fluid.dyeB.slice(),
      pressure: fluid.pressure.slice(),
      before: fluid.before.slice(),
      time,
    }),
    restore(saved) {
      if (saved.u.length !== fluid.u.length) return;
      fluid.u.set(saved.u);
      fluid.v.set(saved.v);
      fluid.dyeA.set(saved.dyeA);
      fluid.dyeB.set(saved.dyeB);
      fluid.pressure.set(saved.pressure);
      fluid.before.set(saved.before);
      time = saved.time;
    },
    // Each snapshot is six grids of floats (about 300 kB at 128 × 96), so keep one second's worth.
    history: 60,
    reset,
    ticksPerSecond: 60,
  });

  panel.append(
    fieldset(
      'Show',
      select({
        label: 'Field',
        options: [
          { id: 'dye', name: 'Dye' },
          { id: 'before', name: 'Divergence before projection' },
          { id: 'after', name: 'Divergence after projection' },
          { id: 'pressure', name: 'Pressure' },
        ],
        value: settings.view as (typeof VIEWS)[number],
        onChange(value) {
          settings.view = value;
          url.save();
          draw();
        },
      }).root,
      checkbox({
        label: 'Velocity arrows',
        checked: settings.arrows,
        onChange(checked) {
          settings.arrows = checked;
          url.save();
          draw();
        },
      }),
    ),
    fieldset(
      'Solver',
      live('Pressure passes', 'iter', 0, 80, 1),
      live('Viscosity', 'visc', 0, 20, 0.5),
      live('Dye diffusion', 'diff', 0, 5, 0.1),
      live('Dye fade', 'fade', 0, 2, 0.05),
      live('Buoyancy (plume)', 'buoy', 0, 200, 5),
    ),
    fieldset(
      'Scene',
      select({
        label: 'Preset',
        options: [
          { id: 'jets', name: 'Two jets' },
          { id: 'plume', name: 'Smoke plume' },
          { id: 'blank', name: 'Blank: stir it yourself' },
        ],
        value: settings.preset as (typeof PRESETS)[number],
        onChange(value) {
          settings.preset = value;
          url.save();
          reset();
        },
      }).root,
      select({
        label: 'Grid',
        options: SIZES.map((size) => ({
          id: String(size),
          name: `${size} × ${(size * 3) / 4}`,
        })),
        value: String(settings.size),
        onChange(value) {
          settings.size = Number(value);
          url.save();
          reset();
        },
      }).root,
      button('Clear', reset),
      el('p', {
        class: 'note',
        text: 'Drag on the canvas to stir and add dye. What you stir in is not kept in the link.',
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-accent)', 'Dye A'],
      ['var(--canvas-compare)', 'Dye B'],
      ['var(--canvas-change)', 'Divergence or pressure above zero'],
      ['var(--canvas-series-3)', 'Below zero'],
    ]),
  );

  about.append(
    prose(
      'The fluid is a grid of cells, each with a velocity and some dye. Every step does three things, and each is chosen so that it cannot blow up, however large the time step. That is what the "stable" in Jos Stam’s stable fluids means.',
    ),
    prose(
      'Advection moves quantities along the flow. Pushing values forward from each cell is unstable, so instead each cell traces backwards: where was the fluid that is here now, one step ago? It takes the value found there, interpolated from the four nearest cells. New values are always averages of old ones, so nothing can grow. Diffusion is solved implicitly for the same reason.',
    ),
    formula(
      'advect:   q(x) ← q(x − u(x)·dt)\nproject:  solve ∇²p = ∇·u,  then  u ← u − ∇p\nsolver:   p[i,j] ← (p[i−1,j] + p[i+1,j] + p[i,j−1] + p[i,j+1] − div[i,j]) / 4',
    ),
    prose(
      'After advection, more fluid may flow into a cell than out of it, which a fluid that cannot be squeezed does not allow. Projection fixes this. It finds the pressure whose gradient cancels the net flow out of every cell and subtracts it. The pressure comes from a Poisson equation solved by Gauss-Seidel passes: each cell is set to what its four neighbours imply, over and over (here with over-relaxation 1.5, starting from the last step’s pressure). Switch the view to divergence before and after to see what the passes remove, and lower the passes to see what is left when they are too few. Velocities are stored on the cell faces, so a converged solve removes the divergence exactly. Cost per step is `O(cells × passes)`.',
    ),
    prose('Back keeps the last 60 frames only, since each snapshot is six full grids.'),
  );

  reset();

  return () => {
    undrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
