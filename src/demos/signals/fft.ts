import { packCells, unpackCells } from '../../core/encode';
import { newSeed, seeded } from '../../core/random';
import { bitReverse, fft, fftTrace, hann, type FftTrace } from '../../core/signals/fft';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';

/** A drawn signal is stored at this resolution and resampled to N. */
const DRAWN = 128;
const LEVELS = 63;
const SIZES = [32, 64, 128, 256];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TAU = 2 * Math.PI;

type Wave = (t: number, noise: readonly number[]) => number;
const SIGNALS: readonly { id: string; name: string; wave: Wave }[] = [
  {
    id: 'mix',
    name: 'Mix of three sines',
    wave: (t) =>
      0.5 * Math.sin(TAU * t) + 0.3 * Math.sin(TAU * 3 * t) + 0.2 * Math.cos(TAU * 10 * t),
  },
  { id: 'square', name: 'Square wave', wave: (t) => ((t * 2) % 1 < 0.5 ? 0.8 : -0.8) },
  { id: 'saw', name: 'Sawtooth', wave: (t) => 1.6 * ((t * 3) % 1) - 0.8 },
  {
    id: 'chirp',
    name: 'Chirp (rising pitch)',
    wave: (t) => 0.8 * Math.sin(TAU * (2 * t + 14 * t * t)),
  },
  { id: 'pulse', name: 'Short pulse', wave: (t) => (Math.abs(t - 0.5) < 0.04 ? 0.9 : 0) },
  { id: 'offbin', name: 'Sine between bins (leakage)', wave: (t) => 0.8 * Math.sin(TAU * 5.5 * t) },
  {
    id: 'noise',
    name: 'Noise',
    wave: (t, noise) => noise[Math.floor(t * noise.length) % noise.length],
  },
];

type Filter = 'all' | 'low' | 'high' | 'top' | 'custom';
const FILTERS: readonly { id: Filter; name: string }[] = [
  { id: 'all', name: 'Keep every bin' },
  { id: 'low', name: 'Low-pass: keep bins up to the cutoff' },
  { id: 'high', name: 'High-pass: keep bins from the cutoff' },
  { id: 'top', name: 'Keep the k largest' },
];

const complexText = (re: number, im: number) => {
  const r = Math.abs(re) < 0.005 ? 0 : re;
  const i = Math.abs(im) < 0.005 ? 0 : im;
  return i === 0 ? r.toFixed(2) : `${r.toFixed(2)} ${i < 0 ? '−' : '+'} ${Math.abs(i).toFixed(2)}i`;
};

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A signal, its frequency spectrum from the fast Fourier transform, and the butterfly steps.',
  );

  const url = urlState({
    view: 'spectrum',
    sig: 'mix',
    s: '',
    n: 128,
    m: 8,
    filter: 'all',
    cut: 8,
    mask: '',
    hann: false,
    phase: false,
    seed: 5,
    speed: 4,
  });
  const settings = url.state;
  if (settings.view !== 'steps') settings.view = 'spectrum';
  if (!SIZES.includes(settings.n)) settings.n = 128;
  if (settings.m !== 16) settings.m = 8;
  if (![...FILTERS.map((f) => f.id), 'custom'].includes(settings.filter as Filter)) {
    settings.filter = 'all';
  }
  settings.cut = clamp(Math.round(settings.cut), 0, settings.n / 2 + 1);
  settings.seed = Math.abs(Math.round(settings.seed)) % 1_000_000_000;

  const isSteps = () => settings.view === 'steps';

  // --- Model ---

  let drawn: number[] | undefined =
    settings.sig === 'custom'
      ? [...unpackCells(settings.s, DRAWN)].map((v) => (v / LEVELS) * 2 - 1)
      : undefined;
  if (!drawn && !SIGNALS.some((p) => p.id === settings.sig)) settings.sig = SIGNALS[0].id;

  /** The signal at `count` evenly spaced points. */
  function sample(count: number): number[] {
    if (drawn) {
      const source = drawn;
      return Array.from({ length: count }, (_, i) => {
        const at = (i * DRAWN) / count;
        const a = Math.floor(at);
        const b = (a + 1) % DRAWN;
        return source[a] + (source[b] - source[a]) * (at - a);
      });
    }
    const random = seeded(settings.seed);
    const noise = Array.from({ length: 256 }, () => (random() - 0.5) * 1.6);
    const wave = (SIGNALS.find((p) => p.id === settings.sig) ?? SIGNALS[0]).wave;
    return Array.from({ length: count }, (_, i) => wave(i / count, noise));
  }

  // Spectrum view.
  let x: number[] = []; // analysed signal (after the window, if any)
  let specRe = new Float64Array(0);
  let specIm = new Float64Array(0);
  let magnitude: number[] = []; // bins 0..N/2
  let mask: number[] = []; // 1 = kept
  let order: number[] = []; // kept bins, strongest first
  let rank: number[] = []; // position of each bin in `order`, or -1
  let recon = new Float64Array(0);
  let error = 0;

  // Steps view.
  let trace: FftTrace = { steps: [], states: [] };
  let swaps = 0;
  /** doneAt[c][r]: the step after which column c, row r holds its value. */
  let doneAt: number[][] = [];
  let columnPeak: number[] = [];

  function analyse() {
    const n = settings.n;
    const half = n / 2;
    x = sample(n);
    if (settings.hann) {
      const window = hann(n);
      x = x.map((v, i) => v * window[i]);
    }
    specRe = Float64Array.from(x);
    specIm = new Float64Array(n);
    fft(specRe, specIm);
    magnitude = Array.from({ length: half + 1 }, (_, k) => {
      const size = Math.hypot(specRe[k], specIm[k]) / n;
      return k === 0 || k === half ? size : 2 * size;
    });

    const filter = settings.filter as Filter;
    if (filter === 'custom') {
      if (mask.length !== half + 1)
        mask = [...unpackCells(settings.mask, half + 1)].map((v) => (v ? 1 : 0));
    } else if (filter === 'top') {
      const byStrength = magnitude.map((_, k) => k).sort((a, b) => magnitude[b] - magnitude[a]);
      mask = new Array<number>(half + 1).fill(0);
      for (const k of byStrength.slice(0, settings.cut)) mask[k] = 1;
    } else {
      mask = magnitude.map((_, k) =>
        filter === 'all' || (filter === 'low' ? k <= settings.cut : k >= settings.cut) ? 1 : 0,
      );
    }
    order = magnitude
      .map((_, k) => k)
      .filter((k) => mask[k])
      .sort((a, b) => magnitude[b] - magnitude[a]);
    rank = new Array<number>(half + 1).fill(-1);
    order.forEach((k, i) => (rank[k] = i));
  }

  /** Inverse FFT of the first `count` kept bins (with their mirror images). */
  function reconstruct(count: number) {
    const n = settings.n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < count; i++) {
      const k = order[i];
      const mirror = (n - k) % n;
      re[k] = specRe[k];
      im[k] = specIm[k];
      re[mirror] = specRe[mirror];
      im[mirror] = specIm[mirror];
    }
    fft(re, im, true);
    recon = re;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (re[i] - x[i]) ** 2;
    error = Math.sqrt(sum / n);
  }

  function traceSteps() {
    const m = settings.m;
    trace = fftTrace(sample(m));
    swaps = trace.steps.filter((s) => s.type === 'swap').length;
    const stages = Math.log2(m);
    doneAt = Array.from({ length: stages + 2 }, () => new Array<number>(m).fill(0));
    doneAt[1].fill(swaps);
    trace.steps.forEach((step, i) => {
      if (step.type === 'butterfly') {
        doneAt[step.stage + 1][step.a] = i + 1;
        doneAt[step.stage + 1][step.b] = i + 1;
      }
    });
    columnPeak = doneAt.map((rows, c) =>
      Math.max(1e-9, ...rows.map((_, r) => Math.hypot(...valueAt(c, r)))),
    );
  }

  /** The final value of column c, row r. */
  function valueAt(c: number, r: number): [number, number] {
    const state = trace.states[c === 0 ? 0 : doneAt[c][r]];
    return [state.re[r], state.im[r]];
  }

  /** Recomputes everything after an input or setting change. */
  function rebuild(restart = false) {
    if (isSteps()) {
      traceSteps();
      player.setLength(
        trace.steps.length,
        restart ? 0 : Math.min(player.position, trace.steps.length),
      );
    } else {
      analyse();
      player.setLength(order.length, order.length);
    }
    url.save();
  }

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: clamp(settings.speed, 0.5, 200),
    maxSpeed: 200,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => update(),
  });

  // --- Spectrum view ---

  function spectrumGeometry() {
    const { width, height } = stage;
    const pad = 10;
    const split = Math.round(height * 0.48);
    const mid = split / 2 + 8;
    const amplitude = split / 2 - 14;
    const bins = settings.n / 2 + 1;
    const bar = (width - 2 * pad) / bins;
    const base = height - 8;
    const top = split + 24;
    return { pad, split, mid, amplitude, bins, bar, base, top, inner: width - 2 * pad };
  }

  function drawSpectrum() {
    const { ctx, width } = stage;
    const { palette } = theme;
    const g = spectrumGeometry();
    const n = settings.n;
    const position = player.position;

    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    ctx.fillText(
      settings.hann ? 'Signal × Hann window (drag to draw)' : 'Signal (drag to draw)',
      g.pad,
      5,
      g.inner,
    );
    ctx.fillText(
      `Magnitude, bins 0 to ${n / 2} (drag to remove or restore)`,
      g.pad,
      g.split + 5,
      g.inner,
    );

    ctx.strokeStyle = palette.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.pad, Math.round(g.mid) + 0.5);
    ctx.lineTo(width - g.pad, Math.round(g.mid) + 0.5);
    ctx.moveTo(0, g.split + 0.5);
    ctx.lineTo(width, g.split + 0.5);
    ctx.moveTo(g.pad, g.base + 0.5);
    ctx.lineTo(width - g.pad, g.base + 0.5);
    ctx.stroke();

    const plot = (data: ArrayLike<number>, colour: string, lineWidth: number) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = g.pad + ((i + 0.5) / n) * g.inner;
        const py = g.mid - clamp(data[i], -1.15, 1.15) * g.amplitude;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };
    plot(x, palette.muted, 1.5);
    plot(recon, palette.accent, 2);

    const peak = Math.max(1e-9, ...magnitude);
    const room = g.base - g.top;
    const barWidth = Math.max(1, g.bar - (g.bar > 4 ? 1 : 0));
    for (let k = 0; k < g.bins; k++) {
      const left = g.pad + k * g.bar;
      if (!mask[k]) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = palette.faint;
        ctx.fillRect(left, g.top, g.bar + 0.5, room);
        ctx.globalAlpha = 1;
      }
      const h = (magnitude[k] / peak) * room;
      ctx.fillStyle = !mask[k]
        ? palette.muted
        : rank[k] === position - 1 && position < order.length
          ? palette.change
          : rank[k] < position
            ? palette.accent
            : palette.ink;
      if (!mask[k]) ctx.globalAlpha = 0.45;
      ctx.fillRect(left, g.base - h, barWidth, h);
      ctx.globalAlpha = 1;
    }

    if (settings.phase) {
      ctx.fillStyle = palette.compare;
      for (let k = 0; k < g.bins; k++) {
        if (magnitude[k] < peak * 0.02) continue;
        const angle = Math.atan2(specIm[k], specRe[k]);
        const py = g.top + ((Math.PI - angle) / TAU) * room;
        ctx.beginPath();
        ctx.arc(g.pad + (k + 0.5) * g.bar, py, Math.max(2, Math.min(3.5, g.bar / 2)), 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = palette.muted;
      ctx.textAlign = 'right';
      ctx.fillText('phase +π', width - g.pad, g.top - 2);
      ctx.textBaseline = 'bottom';
      ctx.fillText('−π', width - g.pad, g.base - 2);
    }
  }

  // --- Butterfly view ---

  function drawSteps() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const m = settings.m;
    const bits = Math.log2(m);
    const columns = bits + 2;
    const position = player.position;
    const last = position > 0 ? trace.steps[position - 1] : undefined;
    const left = 34;
    const top = 24;
    const columnWidth = (width - left - 6) / columns;
    const rowHeight = (height - top - 6) / m;
    const radius = Math.max(4, Math.min(rowHeight * 0.4, columnWidth * 0.2, 20));
    const numbers = columnWidth >= 118 && rowHeight >= 16;
    const nodeX = (c: number) => left + c * columnWidth + (numbers ? radius + 6 : columnWidth / 2);
    const nodeY = (r: number) => top + (r + 0.5) * rowHeight;

    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.muted;
    if (rowHeight >= 12) {
      for (let r = 0; r < m; r++) {
        ctx.fillText(r.toString(2).padStart(bits, '0'), left - 6, nodeY(r));
      }
    }
    ctx.textAlign = numbers ? 'left' : 'center';
    for (let c = 0; c < columns; c++) {
      const name =
        c === 0
          ? 'input'
          : c === 1
            ? 'bit-rev'
            : `stage ${c - 1}${numbers && c === columns - 1 ? ' = X[k]' : ''}`;
      ctx.fillText(name, numbers ? nodeX(c) - radius : nodeX(c), 12, columnWidth - 4);
    }

    // Wires. Between the first two columns: where the bit reversal sends each sample.
    ctx.lineWidth = 1;
    const wire = (c: number, from: number, to: number, colour: string, bold = false) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = bold ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(nodeX(c) + radius, nodeY(from));
      ctx.lineTo(nodeX(c + 1) - radius, nodeY(to));
      ctx.stroke();
    };
    const swapsDone = Math.min(position, swaps);
    const swapped = new Set<number>();
    for (let i = 0; i < swapsDone; i++) {
      const step = trace.steps[i];
      if (step.type === 'swap') swapped.add(step.i).add(step.j);
    }
    for (let r = 0; r < m; r++) {
      const target = bitReverse(r, bits);
      const moved = target !== r;
      const done = moved ? swapped.has(r) : position > 0;
      const current = last?.type === 'swap' && (last.i === r || last.j === r);
      wire(
        0,
        r,
        done ? target : r,
        current ? palette.change : done ? palette.muted : palette.faint,
        current,
      );
    }
    const pending: [number, number, number][] = [];
    trace.steps.forEach((step, i) => {
      if (step.type !== 'butterfly') return;
      const colour =
        i === position - 1 ? palette.compare : i < position ? palette.muted : palette.faint;
      if (i >= position) {
        for (const [from, to] of [
          [step.a, step.a],
          [step.a, step.b],
          [step.b, step.a],
          [step.b, step.b],
        ]) {
          wire(step.stage, from, to, colour);
        }
      } else pending.push([step.stage, step.a, step.b]);
    });
    // Finished and current butterflies go on top of the ones still to come.
    pending.forEach(([stageIndex, a, b], i) => {
      const current = last?.type === 'butterfly' && i === pending.length - 1;
      const colour = current ? palette.compare : palette.muted;
      wire(stageIndex, a, a, colour, current);
      wire(stageIndex, a, b, colour, current);
      wire(stageIndex, b, a, colour, current);
      wire(stageIndex, b, b, colour, current);
    });

    // Nodes: each value as an arrow, length for size and direction for phase.
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < m; r++) {
        let known = c === 0 || position >= doneAt[c][r];
        let re: number;
        let im: number;
        if (c === 1) {
          // The reversal column shows the array as the swaps happen.
          known = position > 0;
          const state = trace.states[swapsDone];
          re = state.re[r];
          im = state.im[r];
        } else [re, im] = valueAt(c, r);
        const touched =
          known &&
          last !== undefined &&
          ((last.type === 'swap' && c === 1 && (last.i === r || last.j === r)) ||
            (last.type === 'butterfly' && c === last.stage + 1 && (last.a === r || last.b === r)));
        const cx = nodeX(c);
        const cy = nodeY(r);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fillStyle = palette.bg;
        ctx.fill();
        ctx.lineWidth = touched ? 2 : 1;
        ctx.strokeStyle = touched ? palette.change : known ? palette.muted : palette.faint;
        ctx.stroke();
        if (!known) continue;
        const size = Math.hypot(re, im) / columnPeak[c];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(
          cx + (re / columnPeak[c]) * (radius - 1),
          cy - (im / columnPeak[c]) * (radius - 1),
        );
        ctx.strokeStyle = touched ? palette.change : palette.accent;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        if (size < 0.02) {
          ctx.fillStyle = palette.accent;
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
        if (numbers) {
          // Just above the wire, on a patch of background so crossing wires do not strike it out.
          const text = complexText(re, im);
          const tx = cx + radius + 5;
          const room = columnWidth - 2 * radius - 26;
          const textWidth = Math.min(room, ctx.measureText(text).width);
          ctx.fillStyle = palette.bg;
          ctx.fillRect(tx - 2, cy - 18, textWidth + 4, 15);
          ctx.fillStyle = touched ? palette.ink : palette.muted;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(text, tx, cy - 3, room);
          ctx.textBaseline = 'middle';
        }
      }
    }
  }

  function draw() {
    const { ctx, width, height } = stage;
    ctx.clearRect(0, 0, width, height);
    if (isSteps()) drawSteps();
    else drawSpectrum();
  }

  function update() {
    const position = player.position;
    if (isSteps()) {
      draw();
      const m = settings.m;
      const bits = Math.log2(m);
      const butterflies = (m / 2) * bits;
      stepCounters.set({
        n: m,
        swaps: `${Math.min(position, swaps)} / ${swaps}`,
        butterflies: `${Math.max(0, position - swaps)} / ${butterflies}`,
        dft: `${m * m} for the direct sum`,
      });
      const step = position > 0 ? trace.steps[position - 1] : undefined;
      if (!step) {
        status.textContent = `Ready. ${m} samples, so ${bits} stages of ${m / 2} butterflies each.`;
      } else if (step.type === 'swap') {
        const bin = (v: number) => v.toString(2).padStart(bits, '0');
        status.textContent = `Bit reversal: swap rows ${step.i} and ${step.j}, because ${bin(step.i)} read backwards is ${bin(step.j)}.`;
      } else {
        const twiddle = step.k === 0 ? 'w = 1' : `w = e^(−2πi·${step.k}/${step.size})`;
        status.textContent = `Stage ${step.stage}, blocks of ${step.size}: rows ${step.a} and ${step.b} with ${twiddle}. Top = a + w·b, bottom = a − w·b.${
          position >= trace.steps.length ? ' Done: the last column is the spectrum X[k].' : ''
        }`;
      }
      return;
    }
    reconstruct(position);
    draw();
    const n = settings.n;
    counters.set({
      n,
      fft: ((n / 2) * Math.log2(n)).toLocaleString('en-GB'),
      dft: (n * n).toLocaleString('en-GB'),
      bins: `${position} / ${order.length} kept`,
      error: error.toFixed(3),
    });
    if (order.length === 0) {
      status.textContent = 'Every bin is removed, so the reconstruction is zero.';
    } else if (position === 0) {
      status.textContent = 'No frequencies added yet. Play adds the kept bins, strongest first.';
    } else if (position < order.length) {
      const k = order[position - 1];
      status.textContent = `Added bin ${k}: ${k} cycles across the frame, amplitude ${magnitude[k].toFixed(3)}. ${position} of ${order.length} kept bins so far.`;
    } else {
      status.textContent =
        order.length === n / 2 + 1
          ? 'All bins kept: the inverse FFT gives the signal back exactly.'
          : `Inverse FFT of the ${order.length} kept bins out of ${n / 2 + 1}. The grey line is the signal, the coloured line what survives the filter.`;
    }
  }

  // --- Editing on the canvas ---

  let lastIndex = -1;
  let lastValue = 0;
  let keep = 1;
  let dragging: 'signal' | 'bins' | undefined;

  function drawSignal(px: number, py: number, first: boolean) {
    const g = spectrumGeometry();
    if (!drawn) {
      // Start from the signal on screen. A window is not part of the drawing.
      drawn = sample(DRAWN).map((v) => clamp(v, -1, 1));
      settings.sig = 'custom';
      markCustom();
    }
    const index = clamp(Math.floor(((px - g.pad) / g.inner) * DRAWN), 0, DRAWN - 1);
    // Snapped to the levels the link can carry, so a copied link shows the same curve.
    const value =
      (Math.round(((clamp((g.mid - py) / g.amplitude, -1, 1) + 1) / 2) * LEVELS) / LEVELS) * 2 - 1;
    const from = first || lastIndex < 0 ? index : lastIndex;
    const count = Math.abs(index - from);
    for (let s = 0; s <= count; s++) {
      const t = count === 0 ? 1 : s / count;
      drawn[Math.round(from + (index - from) * t)] =
        first || count === 0 ? value : lastValue + (value - lastValue) * t;
    }
    lastIndex = index;
    lastValue = value;
    settings.s = packCells(drawn.map((v) => Math.round(((v + 1) / 2) * LEVELS)));
    rebuild();
  }

  function editBins(px: number, first: boolean) {
    const g = spectrumGeometry();
    const bin = clamp(Math.floor((px - g.pad) / g.bar), 0, g.bins - 1);
    if (first) {
      keep = mask[bin] ? 0 : 1;
      lastIndex = bin;
    }
    for (let k = Math.min(bin, lastIndex); k <= Math.max(bin, lastIndex); k++) mask[k] = keep;
    lastIndex = bin;
    settings.filter = 'custom';
    settings.mask = packCells(mask);
    showFilter();
    rebuild();
  }

  const stopDrag = onDrag(canvas, {
    down(point) {
      if (isSteps()) return false;
      dragging = point.y < spectrumGeometry().split ? 'signal' : 'bins';
      if (dragging === 'signal') drawSignal(point.x, point.y, true);
      else editBins(point.x, true);
      return true;
    },
    move(point) {
      if (dragging === 'signal') drawSignal(point.x, point.y, false);
      else if (dragging === 'bins') editBins(point.x, false);
    },
    up() {
      dragging = undefined;
    },
  });

  // --- Controls ---

  const counters = stats({
    n: 'N',
    fft: 'FFT: (N/2)·log₂N multiplications',
    dft: 'Direct DFT: N²',
    bins: 'Bins added',
    error: 'RMS error',
  });
  const stepCounters = stats({
    n: 'N',
    swaps: 'Swaps',
    butterflies: 'Butterflies (one multiplication each)',
    dft: 'Multiplications otherwise',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const spectrumLegend = legend([
    ['var(--canvas-muted)', 'Signal'],
    ['var(--canvas-accent)', 'Reconstruction and bins in it'],
    ['var(--canvas-change)', 'Bin just added'],
    ['var(--canvas-ink)', 'Kept, not added yet'],
    ['var(--canvas-faint)', 'Removed'],
    ['var(--canvas-compare)', 'Phase'],
  ]);
  const stepsLegend = legend([
    ['var(--canvas-accent)', 'Value: arrow length is size, direction is phase'],
    ['var(--canvas-compare)', 'Butterfly being applied'],
    ['var(--canvas-change)', 'Values just written'],
  ]);

  const signalSelect = select({
    label: 'Signal',
    options: SIGNALS,
    value: settings.sig,
    onChange(id) {
      if (id === 'custom') return;
      settings.sig = id;
      settings.s = '';
      drawn = undefined;
      rebuild();
    },
  });
  function markCustom() {
    if (!signalSelect.input.querySelector('option[value="custom"]')) {
      signalSelect.input.append(el('option', { value: 'custom', text: 'Drawn by hand' }));
    }
    signalSelect.input.value = 'custom';
  }
  if (drawn) markCustom();

  const filterSelect = select<Filter>({
    label: 'Filter',
    options: FILTERS,
    value: 'all',
    onChange(id) {
      if (id === 'custom') return;
      settings.filter = id;
      settings.mask = '';
      showFilter();
      rebuild();
    },
  });
  const cutSlider = slider({
    label: 'Cutoff',
    min: 0,
    max: settings.n / 2 + 1,
    value: settings.cut,
    format: (v) => (settings.filter === 'top' ? `${v} bins` : `bin ${v}`),
    onInput(value) {
      settings.cut = value;
      rebuild();
    },
  });
  const cutLabel = cutSlider.root.querySelector('label');
  function showFilter() {
    const filter = settings.filter as Filter;
    if (filter === 'custom' && !filterSelect.input.querySelector('option[value="custom"]')) {
      filterSelect.input.append(el('option', { value: 'custom', text: 'Chosen by hand' }));
    }
    filterSelect.input.value = filter;
    cutSlider.root.style.display = filter === 'all' || filter === 'custom' ? 'none' : '';
    if (cutLabel) cutLabel.textContent = filter === 'top' ? 'Keep' : 'Cutoff';
    cutSlider.input.max = String(settings.n / 2 + 1);
    cutSlider.set(settings.cut);
  }

  const sizeSelect = select({
    label: 'Samples N',
    options: SIZES.map((n) => ({ id: String(n), name: String(n) })),
    value: String(settings.n),
    onChange(id) {
      settings.n = Number(id);
      settings.cut = Math.min(settings.cut, settings.n / 2 + 1);
      if (settings.filter === 'custom') {
        // A hand-picked mask does not carry over to another size.
        settings.filter = 'all';
        settings.mask = '';
      }
      showFilter();
      rebuild();
    },
  });
  const stepSizeSelect = select({
    label: 'Samples N',
    options: [
      { id: '8', name: '8 (3 stages)' },
      { id: '16', name: '16 (4 stages)' },
    ],
    value: String(settings.m),
    onChange(id) {
      settings.m = Number(id);
      rebuild(true);
    },
  });

  const toggle = (label: string, key: 'hann' | 'phase') =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        rebuild();
      },
    });

  const spectrumGroup = fieldset(
    'Spectrum',
    sizeSelect.root,
    filterSelect.root,
    cutSlider.root,
    toggle('Hann window (less leakage)', 'hann'),
    toggle('Show phase', 'phase'),
  );
  const stepsGroup = fieldset('Butterfly steps', stepSizeSelect.root);

  function showView() {
    const steps = isSteps();
    spectrumGroup.style.display = steps ? 'none' : '';
    stepsGroup.style.display = steps ? '' : 'none';
    counters.root.style.display = steps ? 'none' : '';
    stepCounters.root.style.display = steps ? '' : 'none';
    spectrumLegend.style.display = steps ? 'none' : '';
    stepsLegend.style.display = steps ? '' : 'none';
  }

  panel.append(
    fieldset(
      'Input',
      select({
        label: 'View',
        options: [
          { id: 'spectrum', name: 'Spectrum and filtering' },
          { id: 'steps', name: 'Butterfly steps (small N)' },
        ],
        value: settings.view,
        onChange(view) {
          settings.view = view;
          showView();
          rebuild(true);
        },
      }).root,
      signalSelect.root,
      button('New noise', () => {
        settings.seed = newSeed();
        settings.sig = 'noise';
        settings.s = '';
        drawn = undefined;
        signalSelect.input.value = 'noise';
        rebuild();
      }),
    ),
    spectrumGroup,
    stepsGroup,
    player.root,
  );

  readout.append(counters.root, stepCounters.root, status, spectrumLegend, stepsLegend);

  about.append(
    prose(
      'The discrete Fourier transform writes `N` samples as a sum of `N` sinusoids. Bin `k` holds the size and phase of the one that fits `k` whole cycles into the frame. Computed straight from the definition it takes `N²` multiplications.',
    ),
    formula(
      'X[k] = Σₙ x[n] · e^(−2πi·kn/N)\nsplit into even and odd samples, with w = e^(−2πi·k/N):\nX[k]       = E[k] + w · O[k]\nX[k + N/2] = E[k] − w · O[k]          T(N) = 2·T(N/2) + N/2  →  (N/2)·log₂N',
    ),
    prose(
      'The fast transform uses that split again and again. The pair of lines above is one butterfly: two inputs, one multiplication, two outputs. The iterative version first puts the samples in bit-reversed order, so that every stage combines neighbours in place: pairs, then blocks of four, then eight. The butterfly view plays this for 8 or 16 samples. Arrows are scaled per column.',
    ),
    prose(
      'In the spectrum view, drag across the bars to remove or restore bins, or pick a filter. The inverse transform of what is left is drawn over the signal. Playback adds the kept bins one at a time, strongest first, which is the idea behind lossy audio and image compression. For a real signal bin `N − k` mirrors bin `k`, so only bins 0 to `N/2` are shown.',
    ),
    prose(
      'The transform treats the frame as one period of a repeating signal. A sine that does not fit a whole number of cycles jumps at the seam and its energy leaks into every bin. A Hann window fades both ends to zero, which trades a slightly wider peak for far less leakage.',
    ),
  );

  showFilter();
  showView();
  rebuild(true);

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
