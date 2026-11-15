import {
  NO_ROOT,
  newtonBasin,
  newtonPath,
  polyRoots,
  renderNewtonRows,
  type NewtonView,
} from '../../core/fractals/newton';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { FONT, SMALL } from '../../ui/font';

/** Height of the visible part of the plane; the centre is the origin. */
const SPAN = 3.4;
const MIN_ROOTS = 2;
const MAX_ROOTS = 6;
const MAX_ITER = 100;
/** The picture is first computed this many times coarser, then refined over the next frames. */
const COARSE = 4;
const MAX_PIXELS = 300_000;
const FRAME_BUDGET_MS = 9;

const PRESETS = [
  { id: 'cubic', name: 'z³ − 1', coefficients: [1, 0, 0, -1] },
  { id: 'quartic', name: 'z⁴ − 1', coefficients: [1, 0, 0, 0, -1] },
  { id: 'quintic', name: 'z⁵ − 1', coefficients: [1, 0, 0, 0, 0, -1] },
  { id: 'cycle', name: 'z³ − 2z + 2 (has a cycle)', coefficients: [1, 0, -2, 2] },
] as const;

interface Buffer {
  view: NewtonView;
  data: Uint16Array;
  canvas: HTMLCanvasElement;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const complex = (p: Point) =>
  `${p.x.toFixed(2)} ${p.y < 0 ? '−' : '+'} ${Math.abs(p.y).toFixed(2)}i`.replace('-', '−');

function parsePoints(text: string, limit: number): Point[] {
  const points: Point[] = [];
  for (const part of text.split(';').slice(0, limit)) {
    const [x, y] = part.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x: clamp(x, -3, 3), y: clamp(y, -3, 3) });
    }
  }
  return points;
}
const packPoints = (points: readonly Point[]) =>
  points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'The complex plane coloured by which root Newton’s method reaches from each point.',
  );

  const url = urlState({
    preset: 'cubic',
    roots: '',
    relax: 1,
    iters: 40,
    start: '0.35,0.9',
    speed: 6,
  });
  const settings = url.state;
  settings.relax = clamp(settings.relax, 0.2, 1.9);
  settings.iters = clamp(Math.round(settings.iters), 10, MAX_ITER);

  let roots: Point[] = [];
  let start: Point | undefined = parsePoints(settings.start, 1)[0];
  let path: Point[] = [];
  let shown: Buffer | undefined;
  let refining = 0; // requestAnimationFrame handle of the refinement in progress
  const colours = new Uint32Array(MAX_ROOTS * 256);
  let noRootColour = 0;

  const theme = watchPalette(() => {
    buildColours();
    repaint();
  });
  const stage = createStage(canvas, () => compute());
  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 1,
    maxSpeed: 60,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => repaint(),
  });

  // --- Model ---

  function loadRoots() {
    const preset = PRESETS.find((p) => p.id === settings.preset);
    if (preset) {
      roots = polyRoots(preset.coefficients);
    } else {
      roots = parsePoints(settings.roots, MAX_ROOTS);
      if (roots.length < MIN_ROOTS) {
        settings.preset = 'cubic';
        roots = polyRoots(PRESETS[0].coefficients);
      }
    }
  }

  function rootsEdited() {
    settings.preset = 'custom';
    settings.roots = packPoints(roots);
    presetSelect.input.value = 'custom';
    url.save();
  }

  const pixelSize = () => SPAN / stage.height;
  const toPlane = (p: Point): Point => ({
    x: (p.x - stage.width / 2) * pixelSize(),
    y: -(p.y - stage.height / 2) * pixelSize(),
  });
  const toScreen = (p: Point): Point => ({
    x: stage.width / 2 + p.x / pixelSize(),
    y: stage.height / 2 - p.y / pixelSize(),
  });

  function makeBuffer(width: number, height: number): Buffer {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    return {
      view: { width, height, centreX: 0, centreY: 0, pixel: SPAN / height },
      data: new Uint16Array(width * height),
      canvas: image,
    };
  }

  /** Computes a coarse picture now and a fine one over the following frames. */
  function compute() {
    cancelAnimationFrame(refining);
    path = start ? newtonPath(start.x, start.y, roots, settings.relax, settings.iters) : [];

    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (stage.width * stage.height * ratio * ratio)));
    const fullWidth = Math.max(8, Math.round(stage.width * ratio * fit));
    const fullHeight = Math.max(6, Math.round(stage.height * ratio * fit));

    const coarse = makeBuffer(Math.ceil(fullWidth / COARSE), Math.ceil(fullHeight / COARSE));
    renderNewtonRows(
      coarse.view,
      roots,
      settings.relax,
      settings.iters,
      0,
      coarse.view.height,
      coarse.data,
    );
    shown = coarse;
    repaint();

    const fine = makeBuffer(fullWidth, fullHeight);
    let row = 0;
    const work = () => {
      const deadline = performance.now() + FRAME_BUDGET_MS;
      while (row < fullHeight && performance.now() < deadline) {
        const to = Math.min(fullHeight, row + 4);
        renderNewtonRows(fine.view, roots, settings.relax, settings.iters, row, to, fine.data);
        row = to;
      }
      if (row < fullHeight) {
        refining = requestAnimationFrame(work);
      } else {
        shown = fine;
        repaint();
      }
    };
    refining = requestAnimationFrame(work);
  }

  // --- Rendering ---

  /** Per root, a ramp from its colour (few steps) towards the background (many steps). */
  function buildColours() {
    const { palette } = theme;
    const bg = hexToRgb(palette.bg);
    const pack = (c: number[]) => (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    for (let r = 0; r < MAX_ROOTS; r++) {
      const base = hexToRgb(palette.series[r % palette.series.length]);
      for (let n = 0; n < 256; n++) {
        const fade = 0.8 * (1 - Math.exp(-n / 9));
        colours[r * 256 + n] = pack(base.map((v, j) => Math.round(v + (bg[j] - v) * fade)));
      }
    }
    noRootColour = pack(hexToRgb(palette.muted));
  }

  /** Colours the current buffer for the step count the player is at, then draws. */
  function repaint() {
    if (!shown) return;
    const k = player.position;
    const { width, height } = shown.view;
    const ctx = shown.canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(width, height);
    const out = new Uint32Array(image.data.buffer);
    const data = shown.data;
    let converged = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v === NO_ROOT || (v & 255) > k) {
        out[i] = noRootColour;
      } else {
        out[i] = colours[v];
        converged++;
      }
    }
    ctx.putImageData(image, 0, 0);
    draw();

    counters.set({
      degree: roots.length,
      steps: `${k} / ${settings.iters}`,
      converged: `${((100 * converged) / data.length).toFixed(1)}%`,
    });
    describe();
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    if (!shown) return;
    ctx.imageSmoothingEnabled = shown.view.width * 2 > width;
    ctx.drawImage(shown.canvas, 0, 0, width, height);

    // The iteration path from the chosen start, up to the step the player is at.
    const steps = Math.min(path.length - 1, player.position);
    if (path.length > 0) {
      const points = path.slice(0, steps + 1).map(toScreen);
      for (const [colour, lineWidth] of [
        [palette.bg, 4],
        [palette.ink, 1.5],
      ] as const) {
        ctx.beginPath();
        points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = colour;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 5 : 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? palette.bg : palette.ink;
        ctx.fill();
        ctx.strokeStyle = i === 0 ? palette.ink : palette.bg;
        ctx.lineWidth = i === 0 ? 2 : 1;
        ctx.stroke();
      });
    }

    ctx.font = `${SMALL}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    roots.forEach((r, i) => {
      const p = toScreen(r);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
      ctx.fillStyle = palette.bg;
      ctx.fill();
      ctx.strokeStyle = palette.series[i % palette.series.length];
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = palette.ink;
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    });
  }

  function describe() {
    if (!start) {
      status.textContent = 'Click the picture to choose a starting point. Drag a numbered root.';
      return;
    }
    const k = player.position;
    const hit = newtonBasin(start.x, start.y, roots, settings.relax, settings.iters);
    const where = `Start ${complex(start)}`;
    if (hit === NO_ROOT) {
      status.textContent = `${where}: no root reached in ${settings.iters} steps.`;
    } else if ((hit & 255) > k) {
      status.textContent = `${where}: after ${k} steps it is at ${complex(path[Math.min(k, path.length - 1)])}, not yet at a root.`;
    } else {
      status.textContent = `${where}: reaches root ${(hit >> 8) + 1} in ${hit & 255} steps.`;
    }
  }

  // --- Controls ---

  const counters = stats({ degree: 'Roots', steps: 'Steps shown', converged: 'Area converged' });
  const status = el('p', { class: 'note' });
  const key = el('div');
  function buildLegend() {
    key.replaceChildren(
      legend([
        ...roots.map((_, i) => [`var(--canvas-series-${i + 1})`, `Root ${i + 1}`] as const),
        ['var(--canvas-muted)', 'Not at a root yet'],
      ]),
    );
  }

  const presetSelect = select({
    label: 'Polynomial',
    options: [...PRESETS, { id: 'custom', name: 'Custom roots' }],
    value: PRESETS.some((p) => p.id === settings.preset) ? settings.preset : 'custom',
    onChange(id) {
      if (id === 'custom') {
        rootsEdited();
        return;
      }
      settings.preset = id;
      settings.roots = '';
      url.save();
      loadRoots();
      buildLegend();
      compute();
    },
  });

  let dragging = -1; // index of the root being dragged, or -1 for the starting point
  const dragTo = (point: Point) => {
    const p = toPlane(point);
    if (dragging >= 0) {
      roots[dragging] = { x: clamp(p.x, -3, 3), y: clamp(p.y, -3, 3) };
      rootsEdited();
    } else {
      start = p;
      settings.start = packPoints([p]);
      url.save();
    }
    compute();
  };
  const stopDrag = onDrag(canvas, {
    down(point) {
      dragging = roots.findIndex((r) => {
        const p = toScreen(r);
        return Math.hypot(p.x - point.x, p.y - point.y) < 16;
      });
      dragTo(point);
      return true;
    },
    move: dragTo,
  });

  panel.append(
    fieldset(
      'Polynomial',
      presetSelect.root,
      el(
        'div',
        { class: 'buttons' },
        button('Add root', () => {
          if (roots.length >= MAX_ROOTS) return;
          const angle = 2.4 * roots.length;
          roots.push({ x: 0.6 * Math.cos(angle), y: 0.6 * Math.sin(angle) });
          rootsEdited();
          buildLegend();
          compute();
        }),
        button('Remove', () => {
          if (roots.length <= MIN_ROOTS) return;
          roots.pop();
          rootsEdited();
          buildLegend();
          compute();
        }),
      ),
      el('p', {
        class: 'note',
        text: 'Drag a numbered root to change the polynomial. Click anywhere else to set the starting point.',
      }),
    ),
    fieldset(
      'Method',
      slider({
        label: 'Relaxation a',
        min: 0.2,
        max: 1.9,
        step: 0.05,
        value: settings.relax,
        format: (v) => v.toFixed(2),
        onInput(value) {
          settings.relax = value;
          url.save();
          compute();
        },
      }).root,
      slider({
        label: 'Most steps',
        min: 10,
        max: MAX_ITER,
        step: 5,
        value: settings.iters,
        onInput(value) {
          settings.iters = value;
          url.save();
          player.setLength(value, value);
          compute();
        },
      }).root,
    ),
    player.root,
  );

  readout.append(counters.root, status, key);

  about.append(
    prose(
      'Newton’s method finds a root of `p` by following the tangent: from a guess `z` it jumps to where the straight-line approximation of `p` crosses zero. Each point of the plane is used as a first guess and coloured by the root it ends at. Strong colour means few steps, pale means many.',
    ),
    formula(
      'z ← z − a · p(z) / p′(z)\n\np(z) = (z − r₁)(z − r₂)…(z − rₙ)   ⇒   p′(z) / p(z) = Σ 1 / (z − rᵢ)',
    ),
    prose(
      'Close to a root the method is fast: the number of correct digits doubles each step. Between roots a small change of the start can send it to any of them, so every point on a border touches all the basins at once. That is why the borders are fractal.',
    ),
    prose(
      'It can also fail. For `z³ − 2z + 2` the starts in the grey blobs fall into the cycle 0, 1, 0, 1 and never reach a root. The relaxation `a` scales the jump: below 1 it is slower and the borders get smoother, above 1 it overshoots. Play shows which points have arrived after `k` steps. The cost is `O(pixels · steps · n)`.',
    ),
  );

  buildColours();
  loadRoots();
  buildLegend();
  player.setLength(settings.iters, settings.iters);
  compute();

  return () => {
    cancelAnimationFrame(refining);
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
