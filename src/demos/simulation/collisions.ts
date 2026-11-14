import {
  createDiscs,
  discKinetic,
  discMomentum,
  discPotential,
  gridFor,
  stepDiscs,
  type Discs,
} from '../../core/sim/collisions';
import type { SpatialGrid } from '../../core/sim/grid';
import type { Point } from '../../core/point';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { mix, watchPalette } from '../../ui/theme';
import { phoneDefault, urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clamp, clampInt, every, fit, meter, short, toWorld } from './common';
import { FONT } from '../../ui/font';

/** The box is the same whatever the canvas, so a link starts the same discs everywhere. */
const WIDTH = 800;
const HEIGHT = 600;
const TICKS = 120;
const SHADES = 6;
const BINS = 24;
/** The disc whose grid neighbourhood is drawn. */
const TRACER = 0;
const MAX_FLING = 1400;

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
    'Discs of different sizes bouncing off each other and the walls of a box.',
  );

  const url = urlState({
    n: 400,
    radius: 7,
    mixed: true,
    speed: 120,
    gravity: 0,
    e: 1,
    brute: false,
    grid: true,
    hist: true,
    seed: 5,
  });
  const settings = url.state;
  // On a small canvas the histogram would cover a third of the box.
  if (phoneDefault('hist')) settings.hist = false;
  settings.n = clampInt(settings.n, 2, 2000);
  settings.radius = clamp(settings.radius, 2, 30);
  settings.speed = clampInt(settings.speed, 0, 400);
  settings.gravity = clampInt(settings.gravity, 0, 1500);
  settings.e = clamp(settings.e, 0, 1);
  settings.seed = clampInt(settings.seed, 0, 0xffffffff);

  let discs: Discs = createDiscs(0, WIDTH, HEIGHT, 1, 0, 0, seeded(1));
  let grid: SpatialGrid = gridFor(discs);
  const counts = { candidates: 0, contacts: 0 };
  let energyStart = 0;
  let held: { index: number; x: number; y: number } | undefined;
  const histogram = new Float32Array(BINS);
  const curve = new Float32Array(BINS);
  let histogramTop = 1;
  const timer = meter();
  const due = every(120);

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const params = () => ({
    gravity: settings.gravity,
    restitution: settings.e,
    brute: settings.brute,
  });
  const totalEnergy = () => discKinetic(discs) + discPotential(discs, settings.gravity);

  function reset() {
    discs = createDiscs(
      settings.n,
      WIDTH,
      HEIGHT,
      settings.radius,
      settings.mixed ? 1 : 0,
      settings.speed,
      seeded(settings.seed),
    );
    grid = gridFor(discs);
    held = undefined;
    timer.reset();
    // A step of no time: counts the pairs without moving anything.
    counts.candidates = counts.contacts = 0;
    stepDiscs(discs, params(), grid, 0, counts);
    energyStart = totalEnergy();
    player?.clearHistory();
    draw();
  }

  function changed() {
    url.save();
    energyStart = totalEnergy();
    timer.reset();
    draw();
  }

  /** Speed histogram, and the curve an ideal gas at the same temperature would follow. */
  function measureSpeeds() {
    const n = discs.n;
    if (n === 0) return;
    let sum2 = 0;
    for (let i = 0; i < n; i++) sum2 += discs.vx[i] ** 2 + discs.vy[i] ** 2;
    const top = Math.max(1e-9, Math.sqrt(sum2 / n) * 2.6);
    const width = top / BINS;
    histogram.fill(0);
    curve.fill(0);
    // In two dimensions the mean kinetic energy per disc is kT.
    const kT = Math.max(1e-12, discKinetic(discs) / n);
    for (let i = 0; i < n; i++) {
      const v = Math.hypot(discs.vx[i], discs.vy[i]);
      const bin = Math.floor(v / width);
      if (bin < BINS) histogram[bin] += 1 / n;
      // Discs of different mass share the temperature, not the speed: add one curve per disc.
      const m = discs.m[i];
      for (let k = 0; k < BINS; k++) {
        const mid = (k + 0.5) * width;
        curve[k] += (((m * mid) / kT) * Math.exp((-m * mid * mid) / (2 * kT)) * width) / n;
      }
    }
    histogramTop = 0.02;
    for (let k = 0; k < BINS; k++) histogramTop = Math.max(histogramTop, histogram[k], curve[k]);
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = fit(stage, discs.width, HEIGHT);
    const s = view.scale;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);

    if (settings.grid && !settings.brute) {
      if (discs.n > TRACER) {
        // The block of cells in which the marked disc can touch anything.
        const col = clampInt(Math.floor(discs.x[TRACER] / grid.cellWidth), 0, grid.cols - 1);
        const row = clampInt(Math.floor(discs.y[TRACER] / grid.cellHeight), 0, grid.rows - 1);
        const c0 = Math.max(0, col - 1);
        const r0 = Math.max(0, row - 1);
        const c1 = Math.min(grid.cols - 1, col + 1);
        const r1 = Math.min(grid.rows - 1, row + 1);
        ctx.fillStyle = palette.visit;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(
          c0 * grid.cellWidth * s,
          r0 * grid.cellHeight * s,
          (c1 - c0 + 1) * grid.cellWidth * s,
          (r1 - r0 + 1) * grid.cellHeight * s,
        );
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < grid.cols; c++) {
        const x = Math.round(c * grid.cellWidth * s) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, HEIGHT * s);
      }
      for (let r = 1; r < grid.rows; r++) {
        const y = Math.round(r * grid.cellHeight * s) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(discs.width * s, y);
      }
      ctx.stroke();
    }

    // Discs shaded by speed, one path per shade.
    let sum2 = 0;
    for (let i = 0; i < discs.n; i++) sum2 += discs.vx[i] ** 2 + discs.vy[i] ** 2;
    const fast = Math.max(1e-9, Math.sqrt(sum2 / Math.max(1, discs.n)) * 2);
    ctx.strokeStyle = palette.bg;
    ctx.lineWidth = 1;
    for (let shade = 0; shade < SHADES; shade++) {
      ctx.fillStyle = mix(palette.visit, palette.accent, shade / (SHADES - 1));
      ctx.beginPath();
      for (let i = 0; i < discs.n; i++) {
        if (i === TRACER) continue;
        const speed = Math.hypot(discs.vx[i], discs.vy[i]);
        const mine = Math.min(SHADES - 1, Math.floor((speed / fast) * SHADES));
        if (mine !== shade) continue;
        const x = discs.x[i] * s;
        const y = discs.y[i] * s;
        const r = Math.max(0.8, discs.r[i] * s);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (discs.n <= 1500) ctx.stroke();
    }
    if (discs.n > TRACER) {
      ctx.fillStyle = palette.change;
      ctx.beginPath();
      ctx.arc(
        discs.x[TRACER] * s,
        discs.y[TRACER] * s,
        Math.max(1.5, discs.r[TRACER] * s),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    if (held) {
      ctx.strokeStyle = palette.change;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(discs.x[held.index] * s, discs.y[held.index] * s);
      ctx.lineTo(held.x * s, held.y * s);
      ctx.stroke();
    }

    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, discs.width * s - 1, HEIGHT * s - 1);
    ctx.restore();

    const refresh = due(!player?.playing);
    if (refresh) measureSpeeds();
    if (settings.hist) drawHistogram();

    if (refresh) {
      const p = discMomentum(discs);
      const now = totalEnergy();
      const change = energyStart > 0 ? (now - energyStart) / energyStart : 0;
      const brute = (discs.n * (discs.n - 1)) / 2;
      counters.set({
        discs: short(discs.n),
        candidates: short(counts.candidates),
        brute: short(brute),
        contacts: short(counts.contacts),
        kinetic: short(Math.round(discKinetic(discs))),
        change: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`,
        momentum: `${Math.round(p.x)}, ${Math.round(p.y)}`,
        ms: timer.ms.toFixed(3),
      });
      status.textContent = settings.brute
        ? `Brute force: all ${short(brute)} pairs go to the overlap test, and ${counts.contacts} of them touch.`
        : `Grid of ${grid.cols} × ${grid.rows} cells: only discs in the same or adjacent cells are tested, ${short(counts.candidates)} pairs, and ${counts.contacts} of them touch.`;
    }
  }

  function drawHistogram() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const w = Math.max(110, width * 0.3);
    const h = Math.max(70, height * 0.24);
    const left = width - w - 8;
    const top = 8;
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(left, top, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, w, h);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = palette.ink;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('Speeds', left + 6, top + 4);
    const plotTop = top + 20;
    const plotHeight = h - 26;
    const barWidth = (w - 12) / BINS;
    ctx.fillStyle = palette.accent;
    for (let k = 0; k < BINS; k++) {
      const bar = (histogram[k] / histogramTop) * plotHeight;
      ctx.fillRect(left + 6 + k * barWidth, plotTop + plotHeight - bar, barWidth - 1, bar);
    }
    ctx.strokeStyle = palette.change;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < BINS; k++) {
      const x = left + 6 + (k + 0.5) * barWidth;
      const y = plotTop + plotHeight - (curve[k] / histogramTop) * plotHeight;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // --- Pointer: grab a disc and fling it ---

  const world = (point: Point) => toWorld(fit(stage, discs.width, HEIGHT), point);
  const undrag = onDrag(canvas, {
    down(point) {
      const at = world(point);
      const slack = 10 / fit(stage, discs.width, HEIGHT).scale;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < discs.n; i++) {
        const d = Math.hypot(discs.x[i] - at.x, discs.y[i] - at.y) - discs.r[i];
        if (d < slack && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return false;
      held = { index: best, x: at.x, y: at.y };
      return true;
    },
    move(point) {
      if (!held) return;
      const at = world(point);
      held.x = at.x;
      held.y = at.y;
      if (!player.playing) draw();
    },
    up() {
      if (held && !player.playing) {
        // Paused: the pull becomes the disc's velocity at once.
        pull(held);
      }
      held = undefined;
      energyStart = totalEnergy();
      draw();
    },
  });

  /** Gives the held disc a velocity towards the pointer, proportional to the distance. */
  function pull(grab: { index: number; x: number; y: number }) {
    let vx = (grab.x - discs.x[grab.index]) * 12;
    let vy = (grab.y - discs.y[grab.index]) * 12;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_FLING) {
      vx *= MAX_FLING / speed;
      vy *= MAX_FLING / speed;
    }
    discs.vx[grab.index] = vx;
    discs.vy[grab.index] = vy;
  }

  // --- Controls ---

  const counters = stats({
    discs: 'Discs',
    candidates: 'Pairs tested per step',
    brute: 'Brute force n(n−1)/2',
    contacts: 'Touching',
    kinetic: 'Kinetic energy',
    change: 'Energy change',
    momentum: 'Momentum x, y',
    ms: 'Step, ms',
  });
  const status = el('p', { class: 'note' });

  type FlagKey = 'brute' | 'grid' | 'hist';
  const flag = (label: string, key: FlagKey) =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        changed();
      },
    });
  type NumberKey = 'n' | 'radius' | 'speed';
  const seedSlider = (label: string, key: NumberKey, min: number, max: number, step: number) =>
    slider({
      label,
      min,
      max,
      step,
      value: settings[key],
      onInput(value) {
        settings[key] = value;
        url.save();
        reset();
      },
    }).root;

  const player = simPlayer<Saved>({
    step(dt) {
      if (held) pull(held);
      counts.candidates = counts.contacts = 0;
      timer.time(() => stepDiscs(discs, params(), grid, dt, counts));
    },
    draw,
    snapshot: () => ({
      x: discs.x.slice(),
      y: discs.y.slice(),
      vx: discs.vx.slice(),
      vy: discs.vy.slice(),
    }),
    restore(saved) {
      if (saved.x.length !== discs.n) return;
      discs.x.set(saved.x);
      discs.y.set(saved.y);
      discs.vx.set(saved.vx);
      discs.vy.set(saved.vy);
      held = undefined;
    },
    history: 120,
    reset,
    ticksPerSecond: TICKS,
  });

  panel.append(
    fieldset(
      'Broad phase',
      flag('Brute force (no grid)', 'brute'),
      flag('Show grid', 'grid'),
      flag('Show speed histogram', 'hist'),
    ),
    fieldset(
      'Physics',
      slider({
        label: 'Restitution',
        min: 0,
        max: 1,
        step: 0.05,
        value: settings.e,
        onInput(value) {
          settings.e = value;
          changed();
        },
      }).root,
      slider({
        label: 'Gravity',
        min: 0,
        max: 1500,
        step: 50,
        value: settings.gravity,
        onInput(value) {
          settings.gravity = value;
          changed();
        },
      }).root,
    ),
    fieldset(
      'Discs',
      seedSlider('Count', 'n', 2, 2000, 1),
      seedSlider('Radius', 'radius', 2, 30, 0.5),
      seedSlider('Starting speed', 'speed', 0, 400, 10),
      checkbox({
        label: 'Mixed sizes',
        checked: settings.mixed,
        onChange(checked) {
          settings.mixed = checked;
          url.save();
          reset();
        },
      }),
      button('Shuffle', () => {
        settings.seed = newSeed();
        url.save();
        reset();
      }),
      el('p', { class: 'note', text: 'Drag a disc to fling it. Flings are not kept in the link.' }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-visit)', 'Slow'],
      ['var(--canvas-accent)', 'Fast'],
      ['var(--canvas-change)', 'Marked disc, and the ideal speed curve'],
    ]),
  );

  about.append(
    prose(
      'Finding which discs touch is two problems. The broad phase throws out pairs that cannot possibly touch; the narrow phase tests the rest exactly. Without a broad phase every pair is tested, `n(n−1)/2` per step. Here the box is cut into cells one largest diameter wide and each disc is filed under the cell of its centre. Two touching discs are then always in the same cell or in adjacent ones, so each cell is only compared with itself and four of its neighbours (the other four compare with it).',
    ),
    prose(
      'An overlapping pair is first pushed apart along the line of centres, the lighter disc moving more. If the two are also closing in, an impulse `j` along that line is applied, equal and opposite. `e` is the restitution: 1 keeps all the energy, 0 leaves the discs moving together.',
    ),
    formula(
      'n = (x_b − x_a) / |x_b − x_a|\nj = −(1 + e) ((v_b − v_a) · n) / (1/m_a + 1/m_b)\nv_a −= (j / m_a) n        v_b += (j / m_b) n',
    ),
    prose(
      'Each disc-to-disc impulse conserves momentum exactly, and with `e = 1` and no gravity the kinetic energy stays put too. The walls are what change the total momentum, by reversing one component at a time. Left alone, the speeds settle into the Maxwell-Boltzmann shape for two dimensions, `f(v) ∝ m v exp(−m v² / 2kT)`, whatever they started as; the red curve sums that over the masses present. Mass is proportional to area.',
    ),
  );

  reset();

  return () => {
    undrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
