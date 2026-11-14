import {
  coverage,
  createGrayScott,
  paintB,
  stepGrayScott,
  type GrayScott,
} from '../../core/automata/grayscott';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { snapshotRing } from './ring';

const COLS = 200;
const ROWS = 150;
const DA = 1;
const DB = 0.5;
/** Ticks the Back button can undo. Each snapshot is two grids of floats. */
const HISTORY = 60;
/** B rarely exceeds this, so the colour scale ends here. */
const B_MAX = 0.4;

const PRESETS = [
  {
    id: 'mitosis',
    name: 'Mitosis',
    feed: 0.0367,
    kill: 0.0649,
    note: 'Spots grow, stretch and split in two until they fill the space.',
  },
  {
    id: 'spots',
    name: 'Spots',
    feed: 0.03,
    kill: 0.062,
    note: 'Spots multiply, then settle into a steady pattern of dots.',
  },
  {
    id: 'stripes',
    name: 'Stripes',
    feed: 0.029,
    kill: 0.057,
    note: 'Fronts grow into a maze of winding stripes.',
  },
  {
    id: 'coral',
    name: 'Coral',
    feed: 0.0545,
    kill: 0.062,
    note: 'Branches grow from the tips and never touch, like coral.',
  },
  {
    id: 'waves',
    name: 'Waves',
    feed: 0.018,
    kill: 0.051,
    note: 'Nothing settles: fronts chase and cancel each other.',
  },
] as const;

interface Snapshot {
  a: Float32Array;
  b: Float32Array;
  iterations: number;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Field of two reacting chemicals forming spots and stripes.',
  );

  const url = urlState({ f: 0.0367, k: 0.0649, its: 8, brush: 4, seed: 1, speed: 1 });
  const settings = url.state;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  settings.f = clamp(settings.f, 0.005, 0.09);
  settings.k = clamp(settings.k, 0.03, 0.075);
  settings.its = clamp(Math.round(settings.its), 1, 24);
  settings.brush = clamp(Math.round(settings.brush), 1, 12);

  let grid: GrayScott = createGrayScott(COLS, ROWS);
  let iterations = 0;
  const ring = snapshotRing<Snapshot>(HISTORY, () => ({
    a: new Float32Array(COLS * ROWS),
    b: new Float32Array(COLS * ROWS),
    iterations: 0,
  }));

  const image = document.createElement('canvas');
  image.width = COLS;
  image.height = ROWS;
  const imageCtx = image.getContext('2d');
  const pixels = imageCtx?.createImageData(COLS, ROWS);
  const lut = new Uint32Array(256);

  const theme = watchPalette(() => {
    buildLut();
    draw();
  });
  const stage = createStage(canvas, () => draw());

  // --- Model ---

  function seedField() {
    grid = createGrayScott(COLS, ROWS);
    const random = seeded(settings.seed);
    for (let i = 0; i < 14; i++) {
      paintB(grid, random() * COLS, random() * ROWS, 3 + random() * 4);
    }
    iterations = 0;
    ring.clear();
    player?.clearHistory();
  }

  function tick() {
    ring.push((slot) => {
      slot.a.set(grid.a);
      slot.b.set(grid.b);
      slot.iterations = iterations;
    });
    const params = { feed: settings.f, kill: settings.k, da: DA, db: DB };
    for (let i = 0; i < settings.its; i++) stepGrayScott(grid, params);
    iterations += settings.its;
  }

  function back() {
    const slot = ring.pop();
    if (!slot) return;
    grid.a.set(slot.a);
    grid.b.set(slot.b);
    iterations = slot.iterations;
  }

  // --- Rendering ---

  /** Background colour where there is no B, through the accent, to the ink colour where B is densest. */
  function buildLut() {
    const { palette } = theme;
    const stops = [palette.bg, palette.accent, palette.ink].map(hexToRgb);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * 2;
      const from = stops[t < 1 ? 0 : 1];
      const to = stops[t < 1 ? 1 : 2];
      const u = t < 1 ? t : t - 1;
      const c = from.map((v, j) => Math.round(v + (to[j] - v) * u));
      lut[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }

  function draw() {
    const { ctx, width, height } = stage;
    if (!imageCtx || !pixels) return;
    const out = new Uint32Array(pixels.data.buffer);
    const b = grid.b;
    for (let i = 0; i < out.length; i++) {
      const v = (b[i] * 255) / B_MAX;
      out[i] = lut[v > 255 ? 255 : v < 0 ? 0 : v | 0];
    }
    imageCtx.putImageData(pixels, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const scale = Math.max(width / COLS, height / ROWS);
    ctx.drawImage(
      image,
      (width - scale * COLS) / 2,
      (height - scale * ROWS) / 2,
      scale * COLS,
      scale * ROWS,
    );

    const share = coverage(grid);
    counters.set({
      iterations,
      feed: settings.f.toFixed(4),
      kill: settings.k.toFixed(4),
      cover: `${Math.round(share * 100)}%`,
    });
    const preset = currentPreset();
    status.textContent =
      share === 0
        ? 'No B is left: the field is back in its empty steady state. Paint some B or reseed.'
        : preset
          ? preset.note
          : 'Your own feed and kill rates.';
  }

  // --- Controls ---

  const counters = stats({
    iterations: 'Iterations',
    feed: 'Feed f',
    kill: 'Kill k',
    cover: 'Area with B',
  });
  const status = el('p', { class: 'note' });

  const currentPreset = () =>
    PRESETS.find(
      (p) => Math.abs(p.feed - settings.f) < 1e-6 && Math.abs(p.kill - settings.k) < 1e-6,
    );

  const player = simPlayer<number>({
    step: tick,
    draw,
    snapshot: () => 0,
    restore: back,
    history: 4 * HISTORY,
    reset: seedField,
    ticksPerSecond: 60,
    speed: clamp(settings.speed, 0.25, 4),
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
  });

  const feedSlider = slider({
    label: 'Feed rate f',
    min: 0.005,
    max: 0.09,
    step: 0.0001,
    value: settings.f,
    format: (v) => v.toFixed(4),
    onInput(value) {
      settings.f = value;
      ratesChanged();
    },
  });
  const killSlider = slider({
    label: 'Kill rate k',
    min: 0.03,
    max: 0.075,
    step: 0.0001,
    value: settings.k,
    format: (v) => v.toFixed(4),
    onInput(value) {
      settings.k = value;
      ratesChanged();
    },
  });
  const presetSelect = select({
    label: 'Preset',
    options: [...PRESETS, { id: 'custom', name: 'Custom' }],
    value: currentPreset()?.id ?? 'custom',
    onChange(id) {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      settings.f = preset.feed;
      settings.k = preset.kill;
      feedSlider.set(preset.feed);
      killSlider.set(preset.kill);
      url.save();
      seedField();
      draw();
    },
  });
  function ratesChanged() {
    presetSelect.input.value = currentPreset()?.id ?? 'custom';
    url.save();
    if (!player.playing) draw();
  }

  // Painting: drag to drop chemical B along the stroke.
  let last: { x: number; y: number } | undefined;
  const paint = (point: { x: number; y: number }) => {
    const scale = Math.max(stage.width / COLS, stage.height / ROWS);
    const x = (point.x - (stage.width - scale * COLS) / 2) / scale;
    const y = (point.y - (stage.height - scale * ROWS) / 2) / scale;
    const from = last ?? { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / settings.brush));
    for (let i = 1; i <= steps; i++) {
      paintB(
        grid,
        from.x + ((x - from.x) * i) / steps,
        from.y + ((y - from.y) * i) / steps,
        settings.brush,
      );
    }
    last = { x, y };
    if (!player.playing) draw();
  };
  const stopDrag = onDrag(canvas, {
    down(point) {
      last = undefined;
      paint(point);
      return true;
    },
    move: paint,
  });

  panel.append(
    fieldset(
      'Reaction',
      presetSelect.root,
      feedSlider.root,
      killSlider.root,
      slider({
        label: 'Iterations per tick',
        min: 1,
        max: 24,
        value: settings.its,
        onInput(value) {
          settings.its = value;
          url.save();
        },
      }).root,
    ),
    fieldset(
      'Field',
      slider({
        label: 'Brush radius',
        min: 1,
        max: 12,
        value: settings.brush,
        format: (v) => `${v} cells`,
        onInput(value) {
          settings.brush = value;
          url.save();
        },
      }).root,
      el(
        'div',
        { class: 'buttons' },
        button('Reseed', () => {
          settings.seed = newSeed();
          url.save();
          seedField();
          draw();
        }),
        button('Clear', () => {
          grid = createGrayScott(COLS, ROWS);
          iterations = 0;
          ring.clear();
          player.clearHistory();
          draw();
        }),
      ),
      el('p', { class: 'note', text: 'Drag on the canvas to paint chemical B.' }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-bg)', 'Only A'],
      ['var(--canvas-accent)', 'Some B'],
      ['var(--canvas-ink)', 'Most B'],
    ]),
  );

  about.append(
    prose(
      'Two chemicals, A and B, sit on a grid. Both spread to neighbouring cells, A twice as fast as B. Where they meet, one A and two B make three B. Fresh A is fed in everywhere and B is steadily removed.',
    ),
    formula(
      'A′ = A + D_A ∇²A − A·B² + f·(1 − A)\nB′ = B + D_B ∇²B + A·B² − (f + k)·B\n\nD_A = 1, D_B = 0.5, ∇² = weighted sum of the 8 neighbours minus the cell',
    ),
    prose(
      'B needs A to grow and uses it up, so a blob of B starves in its own middle and feeds at its edge. Because A arrives faster than B spreads, the edge sharpens instead of blurring. The feed rate `f` and kill rate `k` decide what that turns into: dots, stripes, dividing cells or restless waves.',
    ),
    prose(
      'Each iteration reads 9 cells per cell, `O(cells)`, on a 200 by 150 torus held in typed arrays. The useful region of `f` and `k` is small. Move a slider slightly and watch one pattern turn into another; move it far and B dies out or floods everything.',
    ),
  );

  buildLut();
  seedField();
  draw();

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
