import {
  BAILOUT,
  escapeTime,
  orbit,
  renderRows,
  type EscapeView,
} from '../../core/fractals/escape';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { canvasPoint } from '../../ui/pointer';
import { hexToRgb, isDark, prefersReducedMotion, watchPalette } from '../../ui/theme';
import { hashParams, urlState } from '../../ui/url';
import { buildLayout, formula, prose, stats, type Mount } from '../layout';
import type { BandRequest, BandResult } from './mandelbrot.worker';

/** Height of the plane shown at zoom 1. */
const SPAN = 2.7;
const MIN_ZOOM = 0.3;
const MIN_ITER = 50;
const MAX_ITER = 5000;
/** The first pass of every render is this many times coarser than the final one. */
const COARSE = 5;
const MAX_PIXELS = 650_000;
/** Colour table entries per iteration, for the smooth colouring. */
const LUT_STEPS = 16;
const ORBIT_POINTS = 80;
const INSET_WIDTH = 132;
const INSET_HEIGHT = 99;
const INSET_ITER = 200;

type Mode = 'm' | 'j';

const HOME: Record<Mode, { x: number; y: number; zoom: number }> = {
  m: { x: -0.65, y: 0, zoom: 1 },
  j: { x: 0, y: 0, zoom: 0.9 },
};

const PLACES = [
  { id: 'home', name: 'Whole set', x: -0.65, y: 0, zoom: 1 },
  { id: 'seahorse', name: 'Seahorse valley', x: -0.7453, y: 0.1127, zoom: 180 },
  { id: 'elephant', name: 'Elephant valley', x: 0.2817, y: 0.0102, zoom: 90 },
  { id: 'spiral', name: 'Triple spiral', x: -0.0883, y: 0.6541, zoom: 110 },
  { id: 'mini', name: 'Small copy on the needle', x: -1.7548777, y: 0, zoom: 45 },
  { id: 'tendrils', name: 'Tendrils', x: -0.7436439, y: 0.1318259, zoom: 60_000 },
  {
    id: 'deep',
    name: 'Deep spiral (near the precision limit)',
    x: -0.743643887037151,
    y: 0.13182590420533,
    zoom: 2e12,
  },
] as const;

const JULIAS = [
  { id: 'rabbit', name: 'Douady rabbit', x: -0.123, y: 0.745 },
  { id: 'dendrite', name: 'Dendrite', x: 0, y: 1 },
  { id: 'sanmarco', name: 'San Marco', x: -0.75, y: 0 },
  { id: 'siegel', name: 'Siegel disc', x: -0.391, y: -0.587 },
  { id: 'spirals', name: 'Spirals', x: -0.8, y: 0.156 },
  { id: 'dust', name: 'Dust (c outside the set)', x: 0.35, y: 0.45 },
] as const;

const PALETTES = [
  { id: 'classic', name: 'Classic' },
  { id: 'theme', name: 'Site colours' },
  { id: 'mono', name: 'Monochrome' },
] as const;

/** One rendered image of some part of the plane. */
interface Frame {
  view: EscapeView;
  /** Escape times; NaN where not computed yet. */
  data: Float32Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function makeFrame(view: EscapeView): Frame | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = view.width;
  canvas.height = view.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  return {
    view,
    data: new Float32Array(view.width * view.height).fill(NaN),
    canvas,
    ctx,
    image: ctx.createImageData(view.width, view.height),
  };
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'The Mandelbrot set, coloured by how quickly each point escapes. Drag to pan, scroll to zoom.',
  );

  const url = urlState({
    mode: 'm',
    x: HOME.m.x,
    y: HOME.m.y,
    zoom: 1,
    cx: -0.12,
    cy: 0.74,
    pin: false,
    iters: 200,
    auto: true,
    pal: 'classic',
    orbit: true,
    speed: 30,
  });
  const settings = url.state;
  if (settings.mode !== 'j') settings.mode = 'm';
  if (!PALETTES.some((p) => p.id === settings.pal)) settings.pal = 'classic';
  settings.x = clamp(settings.x, -4, 4);
  settings.y = clamp(settings.y, -4, 4);
  settings.cx = clamp(settings.cx, -2.5, 2.5);
  settings.cy = clamp(settings.cy, -2.5, 2.5);
  settings.iters = clamp(Math.round(settings.iters), MIN_ITER, MAX_ITER);
  settings.zoom = Math.max(MIN_ZOOM, settings.zoom);
  if (settings.mode === 'j' && !['x', 'y', 'zoom'].some((key) => hashParams().has(key))) {
    // A link that names only the Julia set gets the Julia home view, not the Mandelbrot one.
    Object.assign(settings, HOME.j);
  }
  const mode = () => settings.mode as Mode;
  /** Where the other mode was last left, so switching back returns there. */
  const parked: Record<Mode, { x: number; y: number; zoom: number }> = {
    m: { ...HOME.m },
    j: { ...HOME.j },
  };
  /** In Julia mode: the point whose orbit is drawn. */
  let juliaStart: Point | undefined;

  let shown: Frame | undefined; // last complete image
  let pending: Frame | undefined; // image being filled in
  let pendingRows = 0;
  let nextView: EscapeView | undefined; // the pass to run once `pending` is complete
  let job = 0;
  let queue: BandRequest[] = [];
  let renderHandle = 0;
  let fullTimer = 0; // delays the full-resolution pass while the view is still moving
  /** Steps before anything in view escapes. The player's range starts there, so Play never shows a flat picture. */
  let base = 0;
  let zoomHandle = 0;
  let insetHandle = 0;
  let lut = new Uint32Array(1);
  let insideColour = 0;
  let disposed = false;

  const inset = makeFrame({
    width: INSET_WIDTH,
    height: INSET_HEIGHT,
    centreX: 0,
    centreY: 0,
    pixel: 3.3 / INSET_HEIGHT,
    maxIter: INSET_ITER,
    julia: true,
    cx: 0,
    cy: 0,
  });

  const theme = watchPalette(() => {
    buildLut();
    recolour();
  });
  const stage = createStage(canvas, () => {
    limitZoom();
    scheduleRender();
    draw();
  });
  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 1,
    maxSpeed: 1000,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => recolour(),
  });
  /** The iteration count the picture is drawn for. */
  const shownStep = () => Math.min(settings.iters, base + player.position);

  /** Moves the start of the player's range, keeping the step on screen where it is. */
  function setRange(newBase: number) {
    const atEnd = player.position >= player.length;
    const k = shownStep();
    base = clamp(newBase, 0, settings.iters - 1);
    const length = settings.iters - base;
    player.setLength(length, atEnd ? length : clamp(k - base, 0, length));
  }

  // --- Geometry ---

  /** Width of one CSS pixel in the plane. */
  const pixelSize = () => SPAN / (stage.height * settings.zoom);
  const toPlane = (p: Point): Point => ({
    x: settings.x + (p.x - stage.width / 2) * pixelSize(),
    y: settings.y - (p.y - stage.height / 2) * pixelSize(),
  });
  const toScreen = (x: number, y: number): Point => ({
    x: stage.width / 2 + (x - settings.x) / pixelSize(),
    y: stage.height / 2 - (y - settings.y) / pixelSize(),
  });

  /** Spacing of neighbouring doubles near the centre of the view. */
  const grain = () => Number.EPSILON * Math.max(Math.abs(settings.x), Math.abs(settings.y), 0.25);
  /** Lets the zoom run a little past the point where pixels stop being distinct numbers, and no further. */
  function limitZoom() {
    const most = (4 * SPAN) / (stage.height * grain());
    settings.zoom = clamp(settings.zoom, MIN_ZOOM, most);
  }

  function insetBox() {
    const w = Math.round(clamp(stage.width * 0.3, 96, 200));
    const h = Math.round((w * INSET_HEIGHT) / INSET_WIDTH);
    return { x: stage.width - w - 8, y: stage.height - h - 8, w, h };
  }

  // --- Rendering work, spread over workers ---

  const workerCount = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 6);
  const workers = Array.from({ length: workerCount }, () => {
    const worker = new Worker(new URL('./mandelbrot.worker.ts', import.meta.url), {
      type: 'module',
    });
    const slot = { worker, busy: false };
    worker.onmessage = (event: MessageEvent<BandResult>) => {
      slot.busy = false;
      receive(event.data);
      dispatch();
    };
    return slot;
  });

  function dispatch() {
    for (const slot of workers) {
      if (slot.busy) continue;
      const band = queue.shift();
      if (!band) return;
      slot.busy = true;
      slot.worker.postMessage(band);
    }
  }

  function viewFor(width: number, height: number): EscapeView {
    return {
      width,
      height,
      centreX: settings.x,
      centreY: settings.y,
      pixel: (pixelSize() * stage.width) / width,
      maxIter: settings.iters,
      julia: mode() === 'j',
      cx: settings.cx,
      cy: settings.cy,
    };
  }

  function scheduleRender() {
    if (renderHandle || disposed) return;
    renderHandle = requestAnimationFrame(() => {
      renderHandle = 0;
      startRender();
    });
  }

  /** Starts a new image of the current view: a coarse pass first, then full resolution. */
  function startRender() {
    job++;
    window.clearTimeout(fullTimer);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (stage.width * stage.height * ratio * ratio)));
    const width = Math.max(8, Math.round(stage.width * ratio * fit));
    const height = Math.max(6, Math.round(stage.height * ratio * fit));
    startPass(
      viewFor(Math.ceil(width / COARSE), Math.ceil(height / COARSE)),
      viewFor(width, height),
    );
    updateReadout();
  }

  function startPass(view: EscapeView, then?: EscapeView) {
    pending = makeFrame(view);
    pendingRows = 0;
    nextView = then;
    // Small bands keep every worker busy and let a new view take over quickly.
    const rows = Math.max(4, Math.ceil(60_000 / view.width / Math.sqrt(view.maxIter / 200)));
    queue = [];
    for (let y0 = 0; y0 < view.height; y0 += rows) {
      queue.push({ job, view, y0, y1: Math.min(view.height, y0 + rows) });
    }
    dispatch();
  }

  function receive(result: BandResult) {
    if (result.job !== job || !pending || disposed) return;
    pending.data.set(result.data, result.y0 * pending.view.width);
    colourRows(pending, result.y0, result.y1);
    pendingRows += result.y1 - result.y0;
    if (pendingRows >= pending.view.height) {
      shown = pending;
      pending = undefined;
      if (nextView) {
        // The coarse pass is done. Wait a moment before the costly pass: the view may still be moving.
        const view = nextView;
        const forJob = job;
        fullTimer = window.setTimeout(() => {
          if (forJob === job && !disposed) startPass(view);
        }, 80);
        let least = Infinity;
        for (const v of shown.data) if (v >= 0 && v < least) least = v;
        const first = least === Infinity ? 0 : Math.max(0, Math.floor(least) - 1);
        if (first !== base) setRange(first);
      }
      updateReadout();
    }
    draw();
  }

  // --- Colour ---

  function gradient(stops: readonly (readonly [number, number, number])[], t: number) {
    const scaled = (t - Math.floor(t)) * stops.length;
    const i = Math.floor(scaled) % stops.length;
    const u = scaled - Math.floor(scaled);
    const from = stops[i];
    const to = stops[(i + 1) % stops.length];
    return from.map((v, j) => Math.round(v + (to[j] - v) * u));
  }

  /** Builds the colour table for escape times 0..iters; all palettes start near the page background. */
  function buildLut() {
    const { palette } = theme;
    const dark = isDark();
    const pack = (c: number[]) => (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    const size = settings.iters * LUT_STEPS + 1;
    lut = new Uint32Array(size);
    const classic = [
      [0, 7, 100],
      [32, 107, 203],
      [237, 255, 255],
      [255, 170, 0],
      [0, 2, 0],
    ] as const;
    const site = [palette.bg, palette.accent, palette.ink, palette.compare].map(hexToRgb);
    const bg = hexToRgb(palette.bg);
    const ink = hexToRgb(palette.ink);
    for (let i = 0; i < size; i++) {
      const nu = i / LUT_STEPS;
      // The square root keeps the bands a similar width near the set, where counts rise fast.
      // The offset slows the first few counts, so the far field is one calm colour.
      const t = 0.17 * (Math.sqrt(nu + 8) - Math.sqrt(8));
      if (settings.pal === 'classic') lut[i] = pack(gradient(classic, t + (dark ? 0 : 0.4)));
      else if (settings.pal === 'theme') lut[i] = pack(gradient(site, t));
      else {
        const u = Math.min(1, Math.log1p(nu) / Math.log1p(settings.iters)) ** 0.8;
        lut[i] = pack(bg.map((v, j) => Math.round(v + (ink[j] - v) * u)));
      }
    }
    const inside =
      settings.pal === 'classic' ? [0, 0, 0] : dark ? [10, 12, 13] : hexToRgb(palette.ink);
    insideColour = pack(inside);
  }

  /** Colours rows of a frame for the iteration count the player is at. */
  function colourRows(frame: Frame, y0: number, y1: number) {
    const k = shownStep();
    const out = new Uint32Array(frame.image.data.buffer);
    const { data } = frame;
    const last = lut.length - 1;
    const width = frame.view.width;
    for (let i = y0 * width; i < y1 * width; i++) {
      const v = data[i];
      if (v !== v) out[i] = 0;
      else if (v < 0 || v > k) out[i] = insideColour;
      else out[i] = lut[Math.min(last, (v * LUT_STEPS) | 0)];
    }
    frame.ctx.putImageData(frame.image, 0, 0, 0, y0, width, y1 - y0);
  }

  function recolour() {
    if (shown) colourRows(shown, 0, shown.view.height);
    if (pending) colourRows(pending, 0, pending.view.height);
    paintInset();
    draw();
    updateReadout();
  }

  /** The small Julia set for the current c, computed here: it is tiny. */
  function paintInset() {
    if (!inset || mode() !== 'm') return;
    inset.view.cx = settings.cx;
    inset.view.cy = settings.cy;
    inset.view.maxIter = Math.min(INSET_ITER, settings.iters);
    renderRows(inset.view, 0, INSET_HEIGHT, inset.data);
    colourRows(inset, 0, INSET_HEIGHT);
  }

  function scheduleInset() {
    if (insetHandle) return;
    insetHandle = requestAnimationFrame(() => {
      insetHandle = 0;
      paintInset();
      draw();
      updateReadout();
    });
  }

  function drawFrame(frame: Frame) {
    const { view } = frame;
    const scale = view.pixel / pixelSize();
    const left = toScreen(view.centreX - (view.width / 2) * view.pixel, 0).x;
    const top = toScreen(0, view.centreY + (view.height / 2) * view.pixel).y;
    stage.ctx.drawImage(frame.canvas, left, top, view.width * scale, view.height * scale);
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    if (shown) drawFrame(shown);
    if (pending) drawFrame(pending);

    // The orbit: of 0 under c in Mandelbrot mode, of the clicked point in Julia mode.
    const from = mode() === 'm' ? { x: 0, y: 0 } : juliaStart;
    if (from && settings.orbit) {
      const steps = Math.min(ORBIT_POINTS, shownStep());
      const points = orbit(from.x, from.y, settings.cx, settings.cy, steps);
      for (const [colour, lineWidth] of [
        [palette.bg, 3.5],
        [palette.ink, 1.25],
      ] as const) {
        ctx.beginPath();
        for (let i = 0; i < points.length; i += 2) {
          const p = toScreen(points[i], points[i + 1]);
          // Far-off points would overflow the canvas coordinates.
          const x = clamp(p.x, -1e5, 1e5);
          const y = clamp(p.y, -1e5, 1e5);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colour;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      const marker = mode() === 'm' ? toScreen(settings.cx, settings.cy) : toScreen(from.x, from.y);
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = settings.pin || mode() === 'j' ? palette.ink : palette.bg;
      ctx.fill();
      ctx.strokeStyle = settings.pin || mode() === 'j' ? palette.bg : palette.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (inset && mode() === 'm') {
      const box = insetBox();
      ctx.fillStyle = palette.bg;
      ctx.fillRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      ctx.drawImage(inset.canvas, box.x, box.y, box.w, box.h);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x - 1.5, box.y - 1.5, box.w + 3, box.h + 3);
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const label = 'Julia set';
      const labelWidth = ctx.measureText(label).width + 8;
      ctx.fillStyle = palette.bg;
      ctx.fillRect(box.x, box.y, labelWidth, 18);
      ctx.fillStyle = palette.ink;
      ctx.fillText(label, box.x + 4, box.y + 3);
    }
  }

  // --- Readout ---

  const digits = () => clamp(Math.ceil(Math.log10(settings.zoom)) + 3, 3, 17);
  const complex = (x: number, y: number, places: number) =>
    `${x.toFixed(places)} ${y < 0 ? '−' : '+'} ${Math.abs(y).toFixed(places)}i`.replace('-', '−');
  const zoomText = (zoom: number) =>
    zoom < 1000
      ? `${Number(zoom.toPrecision(3))}×`
      : `${zoom.toExponential(1).replace('e+', 'e')}×`;

  function updateReadout() {
    const k = shownStep();
    counters.set({
      centre: complex(settings.x, settings.y, digits()),
      zoom: zoomText(settings.zoom),
      steps: `${k} / ${settings.iters}`,
      c: complex(settings.cx, settings.cy, 4),
    });

    const c = complex(settings.cx, settings.cy, 3);
    if (mode() === 'm') {
      const time = escapeTime(0, 0, settings.cx, settings.cy, settings.iters);
      const fate =
        time < 0
          ? `the orbit of 0 stays bounded for ${settings.iters} steps, so c is in the set and its Julia set is connected`
          : `the orbit of 0 leaves after ${Math.ceil(time)} steps, so c is outside the set and its Julia set is dust`;
      status.textContent = `c = ${c}: ${fate}. ${settings.pin ? 'Click elsewhere to move c.' : 'Click to pin c.'}`;
    } else if (juliaStart) {
      const time = escapeTime(juliaStart.x, juliaStart.y, settings.cx, settings.cy, settings.iters);
      status.textContent = `Julia set for c = ${c}. The chosen point ${time < 0 ? 'stays bounded' : `escapes after ${Math.ceil(time)} steps`}.`;
    } else {
      status.textContent = `Julia set for c = ${c}. Click a point to see its orbit.`;
    }

    const parts: string[] = [];
    if (k < settings.iters) {
      parts.push(
        `Showing step ${k}: points still within radius ${BAILOUT} after ${k} steps are drawn as inside.`,
      );
      if (base > 0 && player.position === 0) {
        parts.push(`Nothing in this view escapes before step ${base}, so playback starts there.`);
      }
    }
    if (pending) parts.push('Refining the picture.');
    // How many distinct doubles one screen pixel spans.
    const room = pixelSize() / grain();
    if (room < 1) {
      parts.push(
        'Limit of double precision reached: neighbouring pixels are now the same 64-bit number, so the picture breaks into blocks. Going deeper needs arbitrary-precision arithmetic.',
      );
    } else if (room < 2000) {
      parts.push(
        `Close to the limit of double precision: one pixel spans only about ${Math.round(room)} representable numbers.`,
      );
    }
    detail.textContent = parts.join(' ');
  }

  // --- View changes ---

  function autoIterations() {
    if (!settings.auto) return;
    const wanted = clamp(
      Math.round((200 + 110 * Math.log2(Math.max(1, settings.zoom))) / 50) * 50,
      MIN_ITER,
      MAX_ITER,
    );
    if (wanted !== settings.iters) setIterations(wanted);
  }

  function setIterations(value: number) {
    settings.iters = value;
    iterSlider.set(value);
    buildLut();
    setRange(base);
  }

  function viewChanged() {
    limitZoom();
    settings.x = clamp(settings.x, -4, 4);
    settings.y = clamp(settings.y, -4, 4);
    autoIterations();
    url.save();
    scheduleRender();
    draw();
    updateReadout();
  }

  /** Multiplies the zoom by `factor`, keeping the plane point under `anchor` (CSS pixels) fixed. */
  function zoomAbout(anchor: Point, factor: number) {
    const before = toPlane(anchor);
    settings.zoom *= factor;
    limitZoom();
    const after = toPlane(anchor);
    settings.x += before.x - after.x;
    settings.y += before.y - after.y;
    viewChanged();
  }

  /** A short animated zoom, for buttons and double-click. */
  function glideZoom(anchor: Point, factor: number) {
    cancelAnimationFrame(zoomHandle);
    if (prefersReducedMotion()) {
      zoomAbout(anchor, factor);
      return;
    }
    const began = performance.now();
    let done = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - began) / 220);
      const eased = t * (2 - t);
      zoomAbout(anchor, factor ** (eased - done));
      done = eased;
      if (t < 1) zoomHandle = requestAnimationFrame(frame);
    };
    zoomHandle = requestAnimationFrame(frame);
  }

  function goTo(next: Mode, view: { x: number; y: number; zoom: number }) {
    cancelAnimationFrame(zoomHandle);
    if (next !== mode()) {
      parked[mode()] = { x: settings.x, y: settings.y, zoom: settings.zoom };
      // Drop everything computed for the other set, including bands still on their way.
      job++;
      shown = undefined;
      pending = undefined;
      queue = [];
    }
    settings.mode = next;
    settings.x = view.x;
    settings.y = view.y;
    settings.zoom = view.zoom;
    modeButton.textContent =
      next === 'm' ? 'Show the Julia set full size' : 'Back to the Mandelbrot set';
    paintInset();
    viewChanged();
  }

  function setC(x: number, y: number, pin: boolean) {
    settings.cx = clamp(x, -2.5, 2.5);
    settings.cy = clamp(y, -2.5, 2.5);
    settings.pin = pin;
    url.save();
    if (mode() === 'j') {
      scheduleRender();
      draw();
      updateReadout();
    } else {
      scheduleInset();
    }
  }

  // --- Pointer: drag pans, pinch and wheel zoom, a tap picks a point ---

  const touches = new Map<number, Point>();
  let pressedAt: Point | undefined;
  let moved = false;

  const inInset = (p: Point) => {
    const box = insetBox();
    return mode() === 'm' && p.x >= box.x && p.y >= box.y;
  };

  function tap(point: Point) {
    if (inInset(point)) {
      goTo('j', parked.j);
      return;
    }
    const p = toPlane(point);
    if (mode() === 'm') {
      setC(p.x, p.y, true);
    } else {
      juliaStart = p;
      draw();
      updateReadout();
    }
  }

  const onDown = (event: PointerEvent) => {
    if (event.button > 0) return;
    cancelAnimationFrame(zoomHandle);
    canvas.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, canvasPoint(canvas, event));
    pressedAt = canvasPoint(canvas, event);
    moved = touches.size > 1;
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    const point = canvasPoint(canvas, event);
    const previous = touches.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse' && mode() === 'm' && !settings.pin && !inInset(point)) {
        const p = toPlane(point);
        setC(p.x, p.y, false);
      }
      return;
    }
    if (touches.size === 1) {
      if (!moved && pressedAt && Math.hypot(point.x - pressedAt.x, point.y - pressedAt.y) < 5) {
        return;
      }
      moved = true;
      canvas.style.cursor = 'grabbing';
      settings.x -= (point.x - previous.x) * pixelSize();
      settings.y += (point.y - previous.y) * pixelSize();
      touches.set(event.pointerId, point);
      viewChanged();
    } else if (touches.size === 2) {
      const other = [...touches.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (!other) return;
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      touches.set(event.pointerId, point);
      // Move with the midpoint, then scale about it.
      settings.x -= ((point.x - previous.x) / 2) * pixelSize();
      settings.y += ((point.y - previous.y) / 2) * pixelSize();
      const middle = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
      zoomAbout(middle, before > 0 ? clamp(after / before, 0.5, 2) : 1);
    }
  };
  const onUp = (event: PointerEvent) => {
    if (!touches.delete(event.pointerId)) return;
    canvas.style.cursor = '';
    if (!moved && touches.size === 0 && event.type === 'pointerup') {
      tap(canvasPoint(canvas, event));
    }
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    cancelAnimationFrame(zoomHandle);
    const lines = event.deltaMode === 1 ? 33 : 1;
    zoomAbout(
      canvasPoint(canvas, event),
      Math.exp(-clamp(event.deltaY * lines, -400, 400) * 0.002),
    );
  };
  const onDouble = (event: MouseEvent) => {
    const point = canvasPoint(canvas, event);
    if (!inInset(point)) glideZoom(point, event.shiftKey ? 0.5 : 2);
  };
  canvas.classList.add('interactive');
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDouble);

  // --- Controls ---

  const counters = stats({ centre: 'Centre', zoom: 'Zoom', steps: 'Steps shown', c: 'c' });
  const status = el('p', { class: 'note' });
  const detail = el('p', { class: 'note', style: 'flex-basis:100%' });
  const middle = () => ({ x: stage.width / 2, y: stage.height / 2 });

  const modeButton = button(
    settings.mode === 'm' ? 'Show the Julia set full size' : 'Back to the Mandelbrot set',
    () => goTo(mode() === 'm' ? 'j' : 'm', parked[mode() === 'm' ? 'j' : 'm']),
  );
  const iterSlider = slider({
    label: 'Most iterations',
    min: MIN_ITER,
    max: MAX_ITER,
    step: 50,
    value: settings.iters,
    onInput(value) {
      settings.auto = false;
      autoBox.checked = false;
      setIterations(value);
      viewChanged();
    },
  });
  const autoCheck = checkbox({
    label: 'Raise iterations with zoom',
    checked: settings.auto,
    onChange(checked) {
      settings.auto = checked;
      viewChanged();
    },
  });
  const autoBox = autoCheck.querySelector('input') as HTMLInputElement;
  const placeSelect = select({
    label: 'Places',
    options: [{ id: 'none', name: 'Choose a place…' }, ...PLACES],
    value: 'none',
    onChange(id) {
      const place = PLACES.find((p) => p.id === id);
      if (place) goTo('m', place);
      placeSelect.input.value = 'none';
    },
  });
  const juliaSelect = select({
    label: 'Julia sets',
    options: [{ id: 'none', name: 'Choose c…' }, ...JULIAS],
    value: 'none',
    onChange(id) {
      const julia = JULIAS.find((j) => j.id === id);
      if (julia) setC(julia.x, julia.y, true);
      juliaSelect.input.value = 'none';
    },
  });

  panel.append(
    fieldset(
      'View',
      placeSelect.root,
      el(
        'div',
        { class: 'buttons' },
        button('Zoom in', () => glideZoom(middle(), 2)),
        button('Zoom out', () => glideZoom(middle(), 0.5)),
        button('Home', () => goTo(mode(), HOME[mode()])),
      ),
      el('p', {
        class: 'note',
        text: 'Drag to pan. Scroll, pinch or double-click to zoom at the pointer.',
      }),
    ),
    fieldset(
      'Julia set',
      juliaSelect.root,
      modeButton,
      button('Let c follow the pointer', () => {
        settings.pin = false;
        url.save();
        draw();
        updateReadout();
      }),
      checkbox({
        label: 'Draw the orbit',
        checked: settings.orbit,
        onChange(checked) {
          settings.orbit = checked;
          url.save();
          draw();
        },
      }),
    ),
    fieldset(
      'Detail and colour',
      iterSlider.root,
      autoCheck,
      select({
        label: 'Palette',
        options: PALETTES,
        value: settings.pal,
        onChange(id) {
          settings.pal = id;
          url.save();
          buildLut();
          recolour();
        },
      }).root,
    ),
    player.root,
  );

  readout.append(counters.root, status, detail);

  about.append(
    prose(
      'Take a complex number `c`, start from `z = 0` and repeat `z → z² + c`. If `z` stays bounded for ever, `c` belongs to the Mandelbrot set. If it runs away, `c` is outside, and the number of steps it took gives the colour. The line is that orbit for the `c` under the pointer.',
    ),
    formula(
      'z₀ = 0,   zₙ₊₁ = zₙ² + c          Mandelbrot: vary c, one picture\nz₀ = point, zₙ₊₁ = zₙ² + c        Julia: fix c, vary the starting point\n\nescaped when |zₙ| > R;   smooth count ν = n − log₂( ln|zₙ| / ln R )',
    ),
    prose(
      'Each `c` also has its own Julia set: keep `c` fixed and ask the same question of every starting point. The inset shows it. When `c` is inside the Mandelbrot set the Julia set is one connected piece; outside, it falls apart into dust. Counting whole steps gives bands of colour, so the count is made continuous using how far past the radius `z` landed.',
    ),
    prose(
      'Play shows the picture after `k` steps: the region not yet escaped shrinks towards the set. The work is `O(pixels · iterations)` and runs in background workers, coarse first, then sharp. Detail near the boundary needs more iterations the deeper you go. Coordinates are 64-bit floats with about 16 digits, so near a zoom of 10¹³ neighbouring pixels become the same number and the picture turns blocky.',
    ),
  );

  limitZoom();
  if (settings.auto) {
    settings.iters = clamp(
      Math.round((200 + 110 * Math.log2(Math.max(1, settings.zoom))) / 50) * 50,
      MIN_ITER,
      MAX_ITER,
    );
    iterSlider.set(settings.iters);
  }
  buildLut();
  player.setLength(settings.iters, settings.iters);
  scheduleRender();

  return () => {
    disposed = true;
    cancelAnimationFrame(renderHandle);
    cancelAnimationFrame(zoomHandle);
    cancelAnimationFrame(insetHandle);
    window.clearTimeout(fullTimer);
    for (const slot of workers) slot.worker.terminate();
    canvas.classList.remove('interactive');
    canvas.style.cursor = '';
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDouble);
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
