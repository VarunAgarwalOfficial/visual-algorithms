import { newSeed } from '../../core/random';
import {
  SKEW,
  UNSKEW,
  createNoise,
  fbm,
  type Fade,
  type NoiseKind,
} from '../../core/signals/noise';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { FONT } from '../../ui/font';

const KINDS: readonly { id: NoiseKind; name: string }[] = [
  { id: 'perlin', name: 'Perlin (square lattice)' },
  { id: 'simplex', name: 'Simplex (triangles)' },
  { id: 'value', name: 'Value noise' },
];
const FADES: readonly { id: Fade; name: string }[] = [
  { id: 'quintic', name: 'Quintic 6t⁵ − 15t⁴ + 10t³' },
  { id: 'smoothstep', name: 'Smoothstep 3t² − 2t³' },
  { id: 'linear', name: 'Linear (shows the grid)' },
];
type Colouring = 'mono' | 'terrain' | 'contour';
const COLOURINGS: readonly { id: Colouring; name: string }[] = [
  { id: 'mono', name: 'Single tone' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'contour', name: 'Contour lines' },
];

/** The field is computed on a raster at most this wide and scaled up. */
const MAX_RASTER = 272;
const SLICE_SHARE = 0.24;
const BANDS = 12;
/** Cells per second the view drifts, at speed 1. */
const DRIFT_X = 0.45;
const DRIFT_Y = 0.16;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pick = <T extends string>(list: readonly { id: T }[], id: string, fallback: T): T =>
  list.find((item) => item.id === id)?.id ?? fallback;

/** Height colours for the terrain view: [upper limit, r, g, b]. */
const TERRAIN: readonly (readonly [number, number, number, number])[] = [
  [0.3, 38, 70, 120],
  [0.42, 58, 104, 160],
  [0.47, 204, 190, 140],
  [0.6, 98, 150, 84],
  [0.72, 60, 112, 66],
  [0.84, 122, 112, 100],
  [1.01, 236, 236, 232],
];

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A drifting field of smooth noise, with the lattice, one worked sample and a slice graph.',
  );

  const url = urlState({
    kind: 'perlin',
    fade: 'quintic',
    scale: 6,
    oct: 1,
    pers: 0.5,
    lac: 2,
    seed: 7,
    colour: 'mono',
    lattice: true,
    slice: true,
    px: 0.42,
    py: 0.36,
    t: 0,
  });
  const settings = url.state;
  settings.kind = pick(KINDS, settings.kind, 'perlin');
  settings.fade = pick(FADES, settings.fade, 'quintic');
  settings.colour = pick(COLOURINGS, settings.colour, 'mono');
  settings.scale = clamp(Math.round(settings.scale), 2, 24);
  settings.oct = clamp(Math.round(settings.oct), 1, 6);
  settings.pers = clamp(settings.pers, 0.1, 0.9);
  settings.lac = clamp(settings.lac, 1.5, 3);
  settings.seed = Math.abs(Math.round(settings.seed)) % 1_000_000_000;
  settings.px = clamp(settings.px, 0, 1);
  settings.py = clamp(settings.py, 0, 1);
  let time = clamp(settings.t, 0, 100_000);

  let noise = createNoise(settings.seed);
  const raster = document.createElement('canvas');
  const rasterCtx = raster.getContext('2d');
  let image: ImageData | undefined;
  let values = new Float32Array(0);
  const lut = new Uint8ClampedArray(256 * 3);
  let lineColour: [number, number, number] = [0, 0, 0];

  const theme = watchPalette(() => {
    buildLut();
    draw();
  });
  const stage = createStage(canvas, () => draw());

  function buildLut() {
    const { palette } = theme;
    const low = hexToRgb(palette.bg);
    const high = hexToRgb(palette.accent);
    lineColour = hexToRgb(palette.ink);
    for (let i = 0; i < 256; i++) {
      let t = i / 255;
      let rgb: readonly number[];
      if (settings.colour === 'terrain') {
        const band = TERRAIN.find((b) => t < b[0]) ?? TERRAIN[TERRAIN.length - 1];
        rgb = band.slice(1);
      } else {
        if (settings.colour === 'contour') t = (Math.floor(t * BANDS) + 0.5) / BANDS;
        rgb = low.map((v, c) => v + (high[c] - v) * t);
      }
      lut[i * 3] = rgb[0];
      lut[i * 3 + 1] = rgb[1];
      lut[i * 3 + 2] = rgb[2];
    }
  }

  const sampler = (): ((x: number, y: number) => number) => {
    const fadeKind = settings.fade as Fade;
    if (settings.kind === 'simplex') return noise.simplex;
    if (settings.kind === 'value') return (x, y) => noise.value(x, y, fadeKind);
    return (x, y) => noise.perlin(x, y, fadeKind);
  };

  // --- Geometry: noise coordinates are cells; `cell` is one cell in CSS pixels. ---

  const cell = () => stage.width / settings.scale;
  const originX = () => time * DRIFT_X;
  const originY = () => time * DRIFT_Y;
  const fieldHeight = () => stage.height * (settings.slice ? 1 - SLICE_SHARE : 1);
  const probe = () => ({
    x: settings.px * stage.width,
    y: Math.min(settings.py * stage.height, fieldHeight() - 1),
  });

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    if (!rasterCtx || width < 2) return;
    const pixel = Math.max(2, Math.ceil(width / MAX_RASTER));
    const w = Math.ceil(width / pixel);
    const h = Math.ceil(height / pixel);
    if (!image || image.width !== w || image.height !== h) {
      raster.width = w;
      raster.height = h;
      image = rasterCtx.createImageData(w, h);
      values = new Float32Array(w * h);
    }
    const sample = sampler();
    const perPixel = pixel / cell();
    const ox = originX();
    const oy = originY();
    const { oct, pers, lac } = settings;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0, i = 0; y < h; y++) {
      const ny = oy + (y + 0.5) * perPixel;
      for (let x = 0; x < w; x++, i++) {
        const v = fbm(sample, ox + (x + 0.5) * perPixel, ny, oct, pers, lac);
        values[i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const data = image.data;
    const contour = settings.colour === 'contour';
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const level = Math.round((values[i] * 0.5 + 0.5) * 255);
        let r = lut[level * 3];
        let g = lut[level * 3 + 1];
        let b = lut[level * 3 + 2];
        if (contour) {
          const band = Math.floor((values[i] * 0.5 + 0.5) * BANDS);
          const right = x + 1 < w ? Math.floor((values[i + 1] * 0.5 + 0.5) * BANDS) : band;
          const below = y + 1 < h ? Math.floor((values[i + w] * 0.5 + 0.5) * BANDS) : band;
          if (right !== band || below !== band) {
            r = (r + lineColour[0]) / 2;
            g = (g + lineColour[1]) / 2;
            b = (b + lineColour[2]) / 2;
          }
        }
        const k = i * 4;
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
      }
    }
    rasterCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(raster, 0, 0, w * pixel, h * pixel);

    if (settings.lattice) drawLattice();
    const here = drawProbe();
    if (settings.slice) drawSlice(w, h, pixel);

    counters.set({
      value: here.toFixed(3),
      min: lo.toFixed(2),
      max: hi.toFixed(2),
      samples: (w * h * oct).toLocaleString('en-GB'),
    });
    settings.t = Math.round(time * 100) / 100;
    url.save();
  }

  /** A line with a background-coloured edge, so it reads on any part of the field. */
  function haloStroke(colour: string, width: number) {
    const { ctx } = stage;
    ctx.strokeStyle = theme.palette.bg;
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function arrow(x: number, y: number, dx: number, dy: number, colour: string) {
    const { ctx } = stage;
    const length = Math.hypot(dx, dy) || 1;
    const head = Math.min(5, length * 0.35);
    const ux = dx / length;
    const uy = dy / length;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.moveTo(x + dx - head * (ux - uy * 0.6), y + dy - head * (uy + ux * 0.6));
    ctx.lineTo(x + dx, y + dy);
    ctx.lineTo(x + dx - head * (ux + uy * 0.6), y + dy - head * (uy - ux * 0.6));
    haloStroke(colour, 1.25);
  }

  function drawLattice() {
    const { ctx, width } = stage;
    const { palette } = theme;
    const size = cell();
    const height = fieldHeight();
    const ox = originX();
    const oy = originY();
    const toX = (nx: number) => (nx - ox) * size;
    const toY = (ny: number) => (ny - oy) * size;
    const arrows = size >= 26 && settings.kind !== 'value';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;

    if (settings.kind === 'simplex') {
      // Lattice point (i, j) sits at (i − (i + j)·G, j − (i + j)·G).
      const at = (i: number, j: number) => {
        const t = (i + j) * UNSKEW;
        return [toX(i - t), toY(j - t)] as const;
      };
      const skew = (nx: number, ny: number) => (nx + ny) * SKEW;
      const x1 = ox + settings.scale;
      const y1 = oy + height / size;
      const i0 = Math.floor(ox + skew(ox, oy)) - 1;
      const i1 = Math.ceil(x1 + skew(x1, y1)) + 1;
      const j0 = Math.floor(oy + skew(ox, oy)) - 1;
      const j1 = Math.ceil(y1 + skew(x1, y1)) + 1;
      ctx.beginPath();
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const [x, y] = at(i, j);
          if (x < -size || x > width + size || y < -size || y > height + size) continue;
          for (const [di, dj] of [
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const [ex, ey] = at(i + di, j + dj);
            ctx.moveTo(x, y);
            ctx.lineTo(ex, ey);
          }
        }
      }
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (arrows) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const [x, y] = at(i, j);
            if (x < -size || x > width + size || y < -size || y > height + size) continue;
            const [gx, gy] = noise.simplexGradient(i, j);
            arrow(x, y, gx * size * 0.3, gy * size * 0.3, palette.ink);
          }
        }
      }
    } else {
      const i0 = Math.floor(ox);
      const i1 = Math.ceil(ox + settings.scale);
      const j0 = Math.floor(oy);
      const j1 = Math.ceil(oy + height / size);
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        ctx.moveTo(toX(i), 0);
        ctx.lineTo(toX(i), height);
      }
      for (let j = j0; j <= j1; j++) {
        ctx.moveTo(0, toY(j));
        ctx.lineTo(width, toY(j));
      }
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (arrows) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const [gx, gy] = noise.gradient(i, j);
            arrow(toX(i), toY(j), gx * size * 0.34, gy * size * 0.34, palette.ink);
          }
        }
      }
    }
    ctx.restore();
  }

  /** Marks the sample point and the lattice corners that decide it. Returns the field value there. */
  function drawProbe(): number {
    const { ctx } = stage;
    const { palette } = theme;
    const size = cell();
    const p = probe();
    const nx = originX() + p.x / size;
    const ny = originY() + p.y / size;
    const kind = settings.kind as NoiseKind;
    const corners = noise.corners(kind, nx, ny, settings.fade as Fade);
    const first = corners.reduce((a, c) => a + c.contribution, 0);
    const total = fbm(sampler(), nx, ny, settings.oct, settings.pers, settings.lac);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, stage.width, fieldHeight());
    ctx.clip();
    ctx.lineCap = 'round';
    for (const c of corners) {
      const cx = (c.x - originX()) * size;
      const cy = (c.y - originY()) * size;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      haloStroke(palette.compare, 1.5);
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = palette.compare;
      ctx.fill();
      ctx.strokeStyle = palette.bg;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = palette.change;
    ctx.fill();
    ctx.strokeStyle = palette.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    const parts = corners.map((c) => c.dot.toFixed(2)).join(', ');
    const shares = corners.map((c) => c.contribution.toFixed(2)).join(' + ');
    const what =
      kind === 'perlin'
        ? `Gradient · offset at the four corners: ${parts}. Blended by the fade curve: ${shares} = ${first.toFixed(3)}.`
        : kind === 'simplex'
          ? `Gradient · offset at the three corners: ${parts}. Weighted by distance: ${shares} = ${first.toFixed(3)}.`
          : `Random values at the four corners: ${parts}. Blended by the fade curve: ${shares} = ${first.toFixed(3)}.`;
    status.textContent =
      settings.oct > 1
        ? `First octave. ${what} With all ${settings.oct} octaves: ${total.toFixed(3)}.`
        : what;
    return total;
  }

  function drawSlice(w: number, h: number, pixel: number) {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const top = fieldHeight();
    const p = probe();
    // The row being graphed.
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(width, p.y);
    ctx.setLineDash([4, 4]);
    haloStroke(palette.change, 1);
    ctx.setLineDash([]);

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, top, width, height - top);
    ctx.strokeStyle = palette.faint;
    ctx.lineWidth = 1;
    const mid = (top + height) / 2;
    const amplitude = (height - top) / 2 - 5;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(width, top + 0.5);
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(width, Math.round(mid) + 0.5);
    ctx.stroke();

    const row = clamp(Math.floor(p.y / pixel), 0, h - 1);
    if (settings.oct > 1) {
      // The first octave on its own, to show what the others add.
      const sample = sampler();
      const ny = originY() + p.y / cell();
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const v = sample(originX() + ((x + 0.5) * pixel) / cell(), ny);
        const sx = (x + 0.5) * pixel;
        if (x === 0) ctx.moveTo(sx, mid - v * amplitude);
        else ctx.lineTo(sx, mid - v * amplitude);
      }
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) * pixel;
      const sy = mid - values[row * w + x] * amplitude;
      if (x === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const column = clamp(Math.floor(p.x / pixel), 0, w - 1);
    ctx.beginPath();
    ctx.arc(p.x, mid - values[row * w + column] * amplitude, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = palette.change;
    ctx.fill();

    ctx.fillStyle = palette.muted;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Slice along the dashed row', 6, top + 4);
  }

  // --- Controls ---

  const counters = stats({
    value: 'Value at the point',
    min: 'Lowest in view',
    max: 'Highest in view',
    samples: 'Noise samples per frame',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });

  const changed = () => {
    url.save();
    if (!player.playing) draw();
  };

  const stopDrag = onDrag(canvas, {
    down(point) {
      moveProbe(point.x, point.y);
      return true;
    },
    move: (point) => moveProbe(point.x, point.y),
  });
  function moveProbe(x: number, y: number) {
    settings.px = Math.round(clamp(x / stage.width, 0, 1) * 1000) / 1000;
    settings.py = Math.round(clamp(y / stage.height, 0, 1) * 1000) / 1000;
    changed();
  }

  const player = simPlayer<number>({
    step(dt) {
      time += dt;
    },
    draw,
    snapshot: () => time,
    restore(saved) {
      time = saved;
    },
    reset() {
      time = 0;
    },
    ticksPerSecond: 60,
  });

  const fadeSelect = select<Fade>({
    label: 'Fade curve',
    options: FADES,
    value: settings.fade as Fade,
    onChange(value) {
      settings.fade = value;
      changed();
    },
  });
  const showFade = () => (fadeSelect.root.hidden = settings.kind === 'simplex');
  showFade();

  const toggle = (label: string, key: 'lattice' | 'slice') =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        changed();
      },
    });

  panel.append(
    fieldset(
      'Noise',
      select<NoiseKind>({
        label: 'Kind',
        options: KINDS,
        value: settings.kind as NoiseKind,
        onChange(value) {
          settings.kind = value;
          showFade();
          changed();
        },
      }).root,
      fadeSelect.root,
      slider({
        label: 'Cells across',
        min: 2,
        max: 24,
        value: settings.scale,
        onInput(value) {
          settings.scale = value;
          changed();
        },
      }).root,
      button('New seed', () => {
        settings.seed = newSeed();
        noise = createNoise(settings.seed);
        changed();
      }),
    ),
    fieldset(
      'Octaves (fractal sum)',
      slider({
        label: 'Octaves',
        min: 1,
        max: 6,
        value: settings.oct,
        onInput(value) {
          settings.oct = value;
          changed();
        },
      }).root,
      slider({
        label: 'Persistence',
        min: 0.1,
        max: 0.9,
        step: 0.05,
        value: settings.pers,
        format: (v) => v.toFixed(2),
        onInput(value) {
          settings.pers = value;
          changed();
        },
      }).root,
      slider({
        label: 'Lacunarity',
        min: 1.5,
        max: 3,
        step: 0.1,
        value: settings.lac,
        format: (v) => v.toFixed(1),
        onInput(value) {
          settings.lac = value;
          changed();
        },
      }).root,
    ),
    fieldset(
      'View',
      select<Colouring>({
        label: 'Colours',
        options: COLOURINGS,
        value: settings.colour as Colouring,
        onChange(value) {
          settings.colour = value;
          buildLut();
          changed();
        },
      }).root,
      toggle('Show lattice and gradients', 'lattice'),
      toggle('Show slice graph', 'slice'),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-change)', 'Sample point (drag it)'],
      ['var(--canvas-compare)', 'Corners that decide it'],
      ['var(--canvas-accent)', 'Slice: all octaves'],
      ['var(--canvas-muted)', 'Slice: first octave'],
    ]),
  );

  about.append(
    prose(
      'Perlin noise puts a random unit vector, a gradient, on every corner of a square grid. For a point inside a cell, each corner offers the dot product of its gradient with the offset from that corner to the point. The four offers are blended with weights that follow a fade curve. At a corner the offset is zero, so the noise is exactly zero on every lattice point.',
    ),
    formula(
      'n(p) = lerp( lerp(g00·d00, g10·d10, u), lerp(g01·d01, g11·d11, u), v )\nu = fade(x − ⌊x⌋),  v = fade(y − ⌊y⌋),  fade(t) = 6t⁵ − 15t⁴ + 10t³\nfbm(p) = Σ persistenceⁱ · n(lacunarityⁱ · p)  /  Σ persistenceⁱ',
    ),
    prose(
      'The fade curve matters. Linear blending leaves creases along the grid lines. Smoothstep has a flat slope at the ends, and the quintic also has zero curvature there, which hides the grid. Value noise blends random heights instead of gradients and looks blockier.',
    ),
    prose(
      'Simplex noise uses triangles instead of squares, so a point has three corners in 2D instead of four, and `n + 1` instead of `2ⁿ` in `n` dimensions. Each corner adds its gradient dot product times a weight `(0.5 − d²)⁴` that falls to zero before the next triangle, so no blending step is needed.',
    ),
    prose(
      'One layer is smooth and dull. Adding octaves, each finer by the lacunarity and weaker by the persistence, gives the rough look used for terrain and clouds. The cost is one noise sample per pixel per octave. The lattice and the worked sample show the first octave only.',
    ),
  );

  buildLut();
  draw();

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
