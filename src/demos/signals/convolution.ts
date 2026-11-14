import { packCells, unpackCells } from '../../core/encode';
import { newSeed, seeded } from '../../core/random';
import { convolve, convolve2d, convolveAt, gaussianKernel } from '../../core/signals/convolution';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';

const N = 32; // samples in the 1D signal
const SIZE = 16; // the image is SIZE × SIZE
const MAX_KERNEL = 9;
const LEVELS = 63;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));

type Named<T> = { id: string; name: string } & T;

const SIGNALS: readonly Named<{ make(random: () => number): number[] }>[] = [
  {
    id: 'pulses',
    name: 'Two pulses',
    make: () =>
      Array.from({ length: N }, (_, i) => ((i >= 5 && i < 12) || (i >= 20 && i < 23) ? 0.8 : 0)),
  },
  {
    id: 'impulse',
    name: 'Single impulse',
    make: () => Array.from({ length: N }, (_, i) => (i === 10 ? 1 : 0)),
  },
  {
    id: 'step',
    name: 'Step',
    make: () => Array.from({ length: N }, (_, i) => (i >= 12 ? 0.8 : -0.4)),
  },
  {
    id: 'saw',
    name: 'Sawtooth',
    make: () => Array.from({ length: N }, (_, i) => ((i % 8) / 7) * 1.6 - 0.8),
  },
  {
    id: 'sine',
    name: 'Sine',
    make: () => Array.from({ length: N }, (_, i) => 0.85 * Math.sin((i / N) * 4 * Math.PI)),
  },
  {
    id: 'noisy',
    name: 'Noisy sine',
    make: (random) =>
      Array.from({ length: N }, (_, i) =>
        clamp(0.6 * Math.sin((i / N) * 2 * Math.PI) + (random() - 0.5) * 0.7, -1, 1),
      ),
  },
];

const KERNELS: readonly Named<{ values: number[] }>[] = [
  { id: 'box', name: 'Box (moving average)', values: [0.2, 0.2, 0.2, 0.2, 0.2] },
  { id: 'gauss', name: 'Gaussian', values: gaussianKernel(7) },
  { id: 'diff', name: 'Difference (derivative)', values: [1, -1] },
  { id: 'echo', name: 'Echo', values: [1, 0, 0, 0, 0, 0, 0.6] },
];

const KERNELS_2D: readonly Named<{ values: number[] }>[] = [
  { id: 'blur', name: 'Box blur', values: new Array<number>(9).fill(1 / 9) },
  { id: 'gauss', name: 'Gaussian blur', values: [1, 2, 1, 2, 4, 2, 1, 2, 1].map((v) => v / 16) },
  { id: 'sharpen', name: 'Sharpen', values: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
  { id: 'edge', name: 'Edges (Laplacian)', values: [-1, -1, -1, -1, 8, -1, -1, -1, -1] },
  { id: 'sobelx', name: 'Sobel, vertical edges', values: [-1, 0, 1, -2, 0, 2, -1, 0, 1] },
  { id: 'sobely', name: 'Sobel, horizontal edges', values: [-1, -2, -1, 0, 0, 0, 1, 2, 1] },
  { id: 'emboss', name: 'Emboss', values: [-2, -1, 0, -1, 1, 1, 0, 1, 2] },
  { id: 'identity', name: 'Identity', values: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
];

const IMAGES: readonly Named<{ make(random: () => number): number[] }>[] = [
  {
    id: 'shapes',
    name: 'Shapes',
    make: () =>
      Array.from({ length: SIZE * SIZE }, (_, i) => {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        if (x >= 2 && x <= 6 && y >= 2 && y <= 6) return 1;
        if (Math.hypot(x - 10.5, y - 9.5) < 3.6) return 0.75;
        if (y >= 12 && y <= 13 && x >= 1 && x <= 6) return 0.5;
        return 0;
      }),
  },
  {
    id: 'gradient',
    name: 'Gradient and bar',
    make: () =>
      Array.from({ length: SIZE * SIZE }, (_, i) => {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        return y >= 6 && y <= 8 ? 1 - x / (SIZE - 1) : x / (SIZE - 1);
      }),
  },
  {
    id: 'checker',
    name: 'Checkerboard',
    make: () =>
      Array.from({ length: SIZE * SIZE }, (_, i) =>
        (Math.floor((i % SIZE) / 4) + Math.floor(i / SIZE / 4)) % 2 ? 0.9 : 0.1,
      ),
  },
  {
    id: 'speckle',
    name: 'Shapes with noise',
    make: (random) =>
      Array.from({ length: SIZE * SIZE }, (_, i) => {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        const base = x >= 3 && x <= 11 && y >= 4 && y <= 11 ? 0.75 : 0.2;
        return clamp(base + (random() - 0.5) * 0.4, 0, 1);
      }),
  },
  {
    id: 'blank',
    name: 'Blank (draw your own)',
    make: () => new Array<number>(SIZE * SIZE).fill(0),
  },
];

/** Parses "1, 0, -1" into at most `max` numbers, each within ±9. */
function parseNumbers(text: string, max: number): number[] | undefined {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > max) return undefined;
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v))) return undefined;
  return values.map((v) => clamp(Math.round(v * 1000) / 1000, -9, 9));
}

const numbersText = (values: readonly number[]) =>
  values.map((v) => String(Math.round(v * 1000) / 1000)).join(', ');

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A kernel sliding over a signal or an image, with the output built up one sample at a time.',
  );

  const url = urlState({
    mode: '1d',
    sig: 'pulses',
    s: '',
    ker: 'box',
    k: '',
    img: 'shapes',
    im: '',
    ker2: 'blur',
    k2: '',
    seed: 3,
    speed: 8,
  });
  const settings = url.state;
  if (settings.mode !== '2d') settings.mode = '1d';
  settings.seed = Math.abs(Math.round(settings.seed)) % 1_000_000_000;

  // --- Model ---

  let signal: number[] = [];
  let kernel: number[] = [];
  let output: number[] = [];
  let image: number[] = [];
  let kernel2: number[] = [];
  let output2: Float32Array = new Float32Array(SIZE * SIZE);
  /** Outputs of a kernel that sums to zero are signed; they are shown as magnitudes. */
  let signed = false;

  function loadSignal() {
    const preset = SIGNALS.find((p) => p.id === settings.sig);
    if (preset) signal = preset.make(seeded(settings.seed));
    else if (settings.sig === 'custom') {
      signal = [...unpackCells(settings.s, N)].map((v) => (v / LEVELS) * 2 - 1);
    } else {
      settings.sig = SIGNALS[0].id;
      signal = SIGNALS[0].make(seeded(settings.seed));
    }
  }
  function loadKernel() {
    const preset = KERNELS.find((p) => p.id === settings.ker);
    const custom = settings.ker === 'custom' ? parseNumbers(settings.k, MAX_KERNEL) : undefined;
    if (preset) kernel = [...preset.values];
    else if (custom) kernel = custom;
    else {
      settings.ker = KERNELS[0].id;
      kernel = [...KERNELS[0].values];
    }
  }
  function loadImage() {
    const preset = IMAGES.find((p) => p.id === settings.img);
    if (preset) image = preset.make(seeded(settings.seed));
    else if (settings.img === 'custom') {
      image = [...unpackCells(settings.im, SIZE * SIZE)].map((v) => v / LEVELS);
    } else {
      settings.img = IMAGES[0].id;
      image = IMAGES[0].make(seeded(settings.seed));
    }
  }
  function loadKernel2() {
    const preset = KERNELS_2D.find((p) => p.id === settings.ker2);
    const custom = settings.ker2 === 'custom' ? parseNumbers(settings.k2, 9) : undefined;
    if (preset) kernel2 = [...preset.values];
    else if (custom?.length === 9) kernel2 = custom;
    else {
      settings.ker2 = KERNELS_2D[0].id;
      kernel2 = [...KERNELS_2D[0].values];
    }
  }

  const is2d = () => settings.mode === '2d';

  /** Recomputes the outputs. Keeps the playback position unless `restart` is set. */
  function recompute(restart = false) {
    output = convolve(signal, kernel);
    output2 = convolve2d(image, SIZE, SIZE, kernel2);
    signed = Math.abs(kernel2.reduce((a, b) => a + b, 0)) < 1e-6;
    const length = is2d() ? SIZE * SIZE : output.length;
    player.setLength(length, restart ? 0 : Math.min(player.position, length));
    url.save();
  }

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: clamp(settings.speed, 0.5, 500),
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => update(),
  });

  // --- 1D rendering ---

  function geometry1d() {
    const { width, height } = stage;
    const pad = 10;
    const m = kernel.length;
    const slots = N + 2 * (m - 1);
    const slot = (width - 2 * pad) / slots;
    const band = height / 3;
    const amplitude = band / 2 - 12;
    const x = (index: number) => pad + (index + m - 1) * slot;
    const mid = (b: number) => b * band + band / 2 + 7;
    return { pad, m, slot, band, amplitude, x, mid };
  }

  function draw1d() {
    const { ctx, width } = stage;
    const { palette } = theme;
    const g = geometry1d();
    const position = player.position;
    const n = Math.max(0, position - 1); // output index the kernel is lined up with
    const active = position > 0;
    const kernelPeak = Math.max(1e-9, ...kernel.map(Math.abs));
    const outputPeak = Math.max(1e-9, ...output.map(Math.abs));
    const barWidth = Math.max(1, g.slot * 0.72);
    const inset = (g.slot - barWidth) / 2;

    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const labels = [
      'Signal f[k], with the flipped kernel g[n − k] over it',
      'Products f[k] · g[n − k]',
      'Output y[n] = sum of the products',
    ];
    for (let b = 0; b < 3; b++) {
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y = Math.round(g.mid(b)) + 0.5;
      ctx.moveTo(g.pad, y);
      ctx.lineTo(width - g.pad, y);
      if (b > 0) {
        ctx.moveTo(0, Math.round(b * g.band) + 0.5);
        ctx.lineTo(width, Math.round(b * g.band) + 0.5);
      }
      ctx.stroke();
      ctx.fillStyle = palette.muted;
      ctx.fillText(labels[b], g.pad, b * g.band + 5, width - 2 * g.pad);
    }

    const bar = (b: number, index: number, value: number, colour: string) => {
      const h = value * g.amplitude;
      ctx.fillStyle = colour;
      ctx.fillRect(g.x(index) + inset, g.mid(b) - Math.max(h, 0), barWidth, Math.abs(h) || 1);
    };

    // Guide: the output sample being written sits under the kernel's first weight.
    ctx.strokeStyle = active ? palette.change : palette.muted;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const gx = g.x(n) + g.slot / 2;
    ctx.moveTo(gx, g.mid(0) + g.amplitude + 2);
    ctx.lineTo(gx, g.mid(2) - g.amplitude);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let k = 0; k < N; k++) bar(0, k, signal[k], palette.muted);

    // The flipped kernel: weight g[i] sits over signal sample n − i.
    ctx.strokeStyle = active ? palette.compare : palette.muted;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < g.m; i++) {
      const h = (kernel[i] / kernelPeak) * g.amplitude;
      ctx.strokeRect(g.x(n - i) + 0.75, g.mid(0) - Math.max(h, 0), g.slot - 1.5, Math.abs(h) || 1);
    }
    if (active) {
      for (let i = 0; i < g.m; i++) {
        const k = n - i;
        if (k < 0 || k >= N) continue;
        bar(1, k, (signal[k] * kernel[i]) / kernelPeak, palette.change);
      }
    }

    for (let j = 0; j < output.length; j++) {
      const colour =
        j < position - 1 ? palette.accent : j === position - 1 ? palette.change : palette.faint;
      bar(2, j, output[j] / outputPeak, colour);
    }
  }

  // --- 2D rendering ---

  function geometry2d() {
    const { width, height } = stage;
    const pad = 10;
    const side = Math.floor(Math.min((width - 3 * pad) / 2, height - 24 - pad));
    const top = Math.round((height - side) / 2 + 7);
    const gap = Math.max(pad, (width - 2 * side) / 3);
    const cell = side / SIZE;
    return { top, side, cell, left: gap, right: 2 * gap + side };
  }

  const shown = (value: number) => clamp(signed ? Math.abs(value) : value, 0, 1);
  const grey = (value: number) => {
    const level = Math.round(clamp(value, 0, 1) * 255);
    return `rgb(${level}, ${level}, ${level})`;
  };

  function draw2d() {
    const { ctx } = stage;
    const { palette } = theme;
    const g = geometry2d();
    const position = player.position;
    const last = position - 1;
    const cx = last % SIZE;
    const cy = Math.floor(last / SIZE);
    const edge = (i: number) => Math.round(i * g.cell);

    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    ctx.fillText('Input (drag to paint)', g.left, g.top - 8, g.side);
    ctx.fillText(
      signed ? 'Output, shown as |value|' : 'Output, clipped to 0..1',
      g.right,
      g.top - 8,
      g.side,
    );

    for (let i = 0; i < SIZE * SIZE; i++) {
      const col = i % SIZE;
      const row = Math.floor(i / SIZE);
      const x = edge(col);
      const y = edge(row);
      const w = edge(col + 1) - x;
      const h = edge(row + 1) - y;
      ctx.fillStyle = grey(image[i]);
      ctx.fillRect(g.left + x, g.top + y, w, h);
      // Pixels not computed yet stay flat.
      ctx.fillStyle = i < position ? grey(shown(output2[i])) : palette.faint;
      ctx.fillRect(g.right + x, g.top + y, w, h);
    }
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.left - 0.5, g.top - 0.5, g.side + 1, g.side + 1);
    ctx.strokeRect(g.right - 0.5, g.top - 0.5, g.side + 1, g.side + 1);

    if (position === 0) return;
    // The 3×3 window on the input and the pixel it produces.
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.left, g.top, g.side, g.side);
    ctx.clip();
    if (g.cell >= 22) {
      // Flipped kernel weights over the pixels they multiply.
      ctx.font = `${Math.min(12, Math.floor(g.cell * 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const px = cx - i;
          const py = cy - j;
          if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
          const weight = kernel2[(j + 1) * 3 + (i + 1)];
          const text = String(Math.round(weight * 100) / 100).replace(/^(-?)0\./, '$1.');
          ctx.fillStyle = image[py * SIZE + px] > 0.5 ? '#000' : '#fff';
          ctx.fillText(text, g.left + (px + 0.5) * g.cell, g.top + (py + 0.5) * g.cell);
        }
      }
    }
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.compare;
    const wx = clamp(cx - 1, 0, SIZE - 1);
    const wy = clamp(cy - 1, 0, SIZE - 1);
    const wx2 = clamp(cx + 1, 0, SIZE - 1);
    const wy2 = clamp(cy + 1, 0, SIZE - 1);
    ctx.strokeRect(
      g.left + wx * g.cell,
      g.top + wy * g.cell,
      (wx2 - wx + 1) * g.cell,
      (wy2 - wy + 1) * g.cell,
    );
    ctx.strokeStyle = palette.change;
    ctx.strokeRect(g.right + cx * g.cell, g.top + cy * g.cell, g.cell, g.cell);
  }

  function draw() {
    const { ctx, width, height } = stage;
    ctx.clearRect(0, 0, width, height);
    if (is2d()) draw2d();
    else draw1d();
  }

  function update() {
    draw();
    const position = player.position;
    if (is2d()) {
      const last = position - 1;
      const x = last % SIZE;
      const y = Math.floor(last / SIZE);
      const value = position > 0 ? convolveAt(image, SIZE, SIZE, kernel2, x, y) : 0;
      counters.set({
        at: position > 0 ? `x ${x}, y ${y}` : 'none yet',
        mults: position * 9,
        value: position > 0 ? fmt(value) : 'none yet',
        sizes: `${SIZE}×${SIZE} image, 3×3 kernel`,
      });
      status.textContent =
        position === 0
          ? 'Ready. The window will scan the image row by row.'
          : `Pixel (${x}, ${y}): nine input pixels times nine flipped weights add up to ${fmt(value)}${
              position >= SIZE * SIZE ? '. All pixels done.' : '.'
            }`;
      return;
    }
    const n = position - 1;
    let mults = 0;
    for (let j = 0; j < position; j++) {
      mults += Math.min(N - 1, j) - Math.max(0, j - kernel.length + 1) + 1;
    }
    counters.set({
      at: position > 0 ? `n = ${n}` : 'none yet',
      mults,
      value: position > 0 ? fmt(output[n]) : 'none yet',
      sizes: `${N} samples, ${kernel.length} weights`,
    });
    if (position === 0) {
      status.textContent = 'Ready. The kernel is flipped and waits at the left end.';
      return;
    }
    const terms: string[] = [];
    for (let k = Math.max(0, n - kernel.length + 1); k <= Math.min(N - 1, n); k++) {
      terms.push(`${fmt(signal[k])}·${fmt(kernel[n - k])}`);
    }
    status.textContent = `y[${n}] = ${terms.join(' + ')} = ${fmt(output[n])}${
      position >= output.length ? '. Done.' : '.'
    }`;
  }

  // --- Editing on the canvas ---

  let lastIndex = -1;
  let lastValue = 0;
  let paint = 1;

  function editSignal(x: number, y: number, first: boolean) {
    const g = geometry1d();
    const index = clamp(Math.floor((x - g.pad) / g.slot) - (g.m - 1), 0, N - 1);
    // Snapped to the levels the link can carry.
    const value =
      (Math.round(((clamp((g.mid(0) - y) / g.amplitude, -1, 1) + 1) / 2) * LEVELS) / LEVELS) * 2 -
      1;
    // Fill the samples skipped by a fast drag.
    const from = first || lastIndex < 0 ? index : lastIndex;
    const steps = Math.abs(index - from);
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 1 : s / steps;
      const k = Math.round(from + (index - from) * t);
      signal[k] = first || steps === 0 ? value : lastValue + (value - lastValue) * t;
    }
    lastIndex = index;
    lastValue = value;
    settings.sig = 'custom';
    settings.s = packCells(signal.map((v) => Math.round(((v + 1) / 2) * LEVELS)));
    markCustom(signalSelect.input);
    recompute();
  }

  let lastCell: [number, number] | undefined;

  function editImage(x: number, y: number, first: boolean): boolean {
    const g = geometry2d();
    const px = Math.floor((x - g.left) / g.cell);
    const py = Math.floor((y - g.top) / g.cell);
    const inside = px >= 0 && py >= 0 && px < SIZE && py < SIZE;
    if (first) {
      if (!inside) return false;
      paint = image[py * SIZE + px] > 0.5 ? 0 : 1;
      lastCell = undefined;
    }
    // Paint every cell between the last pointer position and this one.
    const [fx, fy] = lastCell ?? [px, py];
    const count = Math.max(Math.abs(px - fx), Math.abs(py - fy));
    let changed = false;
    for (let s = 0; s <= count; s++) {
      const t = count === 0 ? 1 : s / count;
      const cx = Math.round(fx + (px - fx) * t);
      const cy = Math.round(fy + (py - fy) * t);
      if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) continue;
      if (image[cy * SIZE + cx] !== paint) {
        image[cy * SIZE + cx] = paint;
        changed = true;
      }
    }
    lastCell = [px, py];
    if (!changed) return true;
    settings.img = 'custom';
    settings.im = packCells(image.map((v) => Math.round(v * LEVELS)));
    markCustom(imageSelect.input);
    recompute();
    return true;
  }

  const stopDrag = onDrag(canvas, {
    down(point) {
      if (is2d()) return editImage(point.x, point.y, true);
      if (point.y > geometry1d().band) return false;
      editSignal(point.x, point.y, true);
      return true;
    },
    move(point) {
      if (is2d()) editImage(point.x, point.y, false);
      else editSignal(point.x, point.y, false);
    },
  });

  // --- Controls ---

  const counters = stats({
    at: 'Output sample',
    mults: 'Multiplications',
    value: 'Value',
    sizes: 'Sizes',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const problem = el('p', { class: 'note error', role: 'status' });
  problem.hidden = true;

  function markCustom(input: HTMLSelectElement) {
    if (!input.querySelector('option[value="custom"]')) {
      input.append(el('option', { value: 'custom', text: 'Custom' }));
    }
    input.value = 'custom';
  }

  const signalSelect = select({
    label: 'Signal',
    options: SIGNALS,
    value: settings.sig,
    onChange(id) {
      if (id === 'custom') return;
      settings.sig = id;
      loadSignal();
      recompute();
    },
  });
  const kernelSelect = select({
    label: 'Kernel',
    options: KERNELS,
    value: settings.ker,
    onChange(id) {
      if (id === 'custom') return;
      settings.ker = id;
      loadKernel();
      kernelInput.input.value = numbersText(kernel);
      problem.hidden = true;
      recompute();
    },
  });
  const kernelInput = textInput({
    label: `Kernel weights g[0], g[1], … (up to ${MAX_KERNEL})`,
    value: '',
    maxLength: 80,
    onChange(text) {
      const values = parseNumbers(text, MAX_KERNEL);
      problem.hidden = Boolean(values);
      if (!values) {
        problem.textContent = `Type 1 to ${MAX_KERNEL} numbers separated by commas.`;
        return;
      }
      kernel = values;
      settings.ker = 'custom';
      settings.k = numbersText(values);
      markCustom(kernelSelect.input);
      recompute();
    },
  });

  const imageSelect = select({
    label: 'Image',
    options: IMAGES,
    value: settings.img,
    onChange(id) {
      if (id === 'custom') return;
      settings.img = id;
      loadImage();
      recompute();
    },
  });
  const kernel2Select = select({
    label: 'Kernel',
    options: KERNELS_2D,
    value: settings.ker2,
    onChange(id) {
      if (id === 'custom') return;
      settings.ker2 = id;
      loadKernel2();
      fillGrid();
      recompute();
    },
  });
  const cells = Array.from({ length: 9 }, (_, i) => {
    const input = el('input', {
      type: 'number',
      step: '0.25',
      min: '-9',
      max: '9',
      'aria-label': `Kernel row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}`,
      style: 'width: 100%; min-width: 0; text-align: center; padding-inline: 2px;',
    });
    input.addEventListener('input', () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      kernel2[i] = clamp(value, -9, 9);
      settings.ker2 = 'custom';
      settings.k2 = numbersText(kernel2);
      markCustom(kernel2Select.input);
      recompute();
    });
    return input;
  });
  const grid = el(
    'div',
    {
      role: 'group',
      'aria-label': 'Kernel weights',
      style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;',
    },
    ...cells,
  );
  const fillGrid = () =>
    cells.forEach((input, i) => (input.value = String(Math.round(kernel2[i] * 1000) / 1000)));

  const group1d = fieldset(
    'Signal and kernel',
    signalSelect.root,
    kernelSelect.root,
    kernelInput.root,
    problem,
  );
  const group2d = fieldset(
    'Image and kernel',
    imageSelect.root,
    kernel2Select.root,
    el('div', { class: 'field' }, el('label', { text: 'Weights (edit any cell)' }), grid),
  );
  const showMode = () => {
    group1d.style.display = is2d() ? 'none' : '';
    group2d.style.display = is2d() ? '' : 'none';
  };

  panel.append(
    fieldset(
      'Mode',
      select({
        label: 'Convolve',
        options: [
          { id: '1d', name: 'A 1D signal' },
          { id: '2d', name: 'A 2D image' },
        ],
        value: settings.mode,
        onChange(mode) {
          settings.mode = mode;
          showMode();
          recompute(true);
        },
      }).root,
      button('New random noise', () => {
        settings.seed = newSeed();
        if (is2d()) {
          settings.img = 'speckle';
          imageSelect.input.value = 'speckle';
          loadImage();
        } else {
          settings.sig = 'noisy';
          signalSelect.input.value = 'noisy';
          loadSignal();
        }
        recompute();
      }),
    ),
    group1d,
    group2d,
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-compare)', 'Kernel window'],
      ['var(--canvas-change)', 'Products and the sample being written'],
      ['var(--canvas-accent)', 'Output so far'],
    ]),
  );

  about.append(
    prose(
      'Convolution slides one sequence over another. For each output position the kernel is flipped, lined up with the signal, multiplied sample by sample, and the products are added. Drag in the top band to redraw the signal, or type your own kernel weights.',
    ),
    formula(
      '(f ∗ g)[n] = Σₖ f[k] · g[n − k]\n2D:  (f ∗ g)[x, y] = Σᵢ Σⱼ f[x − i, y − j] · g[i, j]',
    ),
    prose(
      'The flip is why a single impulse in the signal comes out as a copy of the kernel, the right way round. Try the impulse with the echo kernel. A box kernel averages neighbours and smooths; the difference kernel `1, −1` responds only where the signal changes.',
    ),
    prose(
      'An image filter is the same sum over a 3×3 window. Blurs have weights that add to one. Edge kernels add to zero, so flat areas give zero and the output is signed; it is shown as a magnitude. Pixels past the border repeat the edge pixel.',
    ),
    prose(
      'The direct method costs one multiplication per signal sample per kernel weight: `O(n·m)`. For long kernels it is faster to multiply the two spectra with the FFT, in `O(n log n)`.',
    ),
  );

  loadSignal();
  loadKernel();
  loadImage();
  loadKernel2();
  if (settings.sig === 'custom') markCustom(signalSelect.input);
  if (settings.ker === 'custom') markCustom(kernelSelect.input);
  if (settings.img === 'custom') markCustom(imageSelect.input);
  if (settings.ker2 === 'custom') markCustom(kernel2Select.input);
  signalSelect.input.value = settings.sig;
  kernelSelect.input.value = settings.ker;
  imageSelect.input.value = settings.img;
  kernel2Select.input.value = settings.ker2;
  kernelInput.input.value = numbersText(kernel);
  fillGrid();
  showMode();
  recompute(true);

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
