import { dft, epicycleChain, toEpicycles, traceCurve, type Epicycle } from '../core/fourier/dft';
import { normalise, pathLength, resample } from '../core/fourier/path';
import { heart, smiley, square, star, trefoil } from '../core/fourier/shapes';
import type { Point } from '../core/geometry';
import { createLoop, createStage } from '../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../ui/dom';
import { prefersReducedMotion, watchPalette } from '../ui/theme';
import { buildLayout, prose, type Demo } from './layout';
import { sampleSvg } from './svg';

/** Samples taken along the outline. The DFT is O(N²), so this stays modest. */
const SAMPLES = 512;
/** Points on the reconstructed curve; finer than the samples so it looks smooth. */
const CURVE_POINTS = 1024;
const MAX_CIRCLES = SAMPLES / 2 - 1;
/** Seconds for one lap at 1x speed. */
const LAP_SECONDS = 14;
const MAX_FILE_BYTES = 2_000_000;
const TAU = 2 * Math.PI;

const PRESETS = [
  { id: 'smiley', name: 'Smiley (2022 original)', points: smiley },
  { id: 'heart', name: 'Heart', points: heart },
  { id: 'star', name: 'Star', points: star },
  { id: 'square', name: 'Square', points: square },
  { id: 'trefoil', name: 'Trefoil', points: trefoil },
] as const;

type ShapeId = (typeof PRESETS)[number]['id'] | 'custom';

function mount(root: HTMLElement): () => void {
  const { canvas, panel, about } = buildLayout(
    root,
    fourier,
    'Animation of rotating circles joined tip to tail, tracing the outline of a shape.',
  );

  const reduced = prefersReducedMotion();
  let samples: Point[] = [];
  let epicycles: Epicycle[] = [];
  let curve: Float64Array = new Float64Array(0);
  let circles = 24;
  let speed = 1;
  let time = 0; // position in the lap, [0, 1)
  let traced = 0; // how many curve points the pen has drawn so far
  let showCircles = true;
  let showTarget = true;
  let drawing = false;
  let stroke: Point[] = [];
  let strokeActive = false;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const loop = createLoop((dt) => {
    time += (dt * speed) / LAP_SECONDS;
    if (time >= 1) {
      time -= 1;
      traced = CURVE_POINTS;
    }
    traced = Math.max(traced, Math.floor(time * CURVE_POINTS));
    draw();
  });

  // --- Model ---

  function setShape(points: readonly Point[]) {
    samples = normalise(resample(points, SAMPLES));
    epicycles = toEpicycles(dft(samples));
    retrace();
    restart();
  }

  function retrace() {
    curve = traceCurve(epicycles, circles, CURVE_POINTS);
  }

  function restart() {
    time = 0;
    // While paused (the default with reduced motion) show the finished drawing, not a blank canvas.
    traced = playing ? 0 : CURVE_POINTS;
    draw();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (drawing) {
      drawStroke();
      return;
    }

    const scale = Math.min(width, height) * 0.4;
    const cx = width / 2;
    const cy = height / 2;
    const px = (x: number) => cx + x * scale;
    const py = (y: number) => cy + y * scale;

    if (showTarget) {
      ctx.beginPath();
      for (const p of samples) ctx.lineTo(px(p.x), py(p.y));
      ctx.closePath();
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    const end = Math.min(traced, CURVE_POINTS);
    if (end > 1) {
      ctx.beginPath();
      for (let i = 0; i < end; i++) ctx.lineTo(px(curve[i * 2]), py(curve[i * 2 + 1]));
      if (end === CURVE_POINTS) ctx.closePath();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const chain = epicycleChain(epicycles, time, circles);
    if (showCircles) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = palette.muted;
      ctx.globalAlpha = 0.45;
      for (let i = 1; i < chain.length - 1; i++) {
        const radius = epicycles[i].amplitude * scale;
        if (radius < 0.75) continue;
        ctx.beginPath();
        ctx.arc(px(chain[i].x), py(chain[i].y), radius, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 1; i < chain.length; i++) ctx.lineTo(px(chain[i].x), py(chain[i].y));
      ctx.strokeStyle = palette.ink;
      ctx.stroke();
    }

    const pen = chain[chain.length - 1];
    ctx.beginPath();
    ctx.arc(px(pen.x), py(pen.y), 3.5, 0, TAU);
    ctx.fillStyle = palette.accent;
    ctx.fill();
  }

  function drawStroke() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    if (stroke.length === 0) {
      ctx.fillStyle = palette.muted;
      ctx.font = '15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Draw one continuous line. It closes when you let go.', width / 2, height / 2);
      return;
    }
    ctx.beginPath();
    for (const p of stroke) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (stroke.length > 2) {
      // Preview of the closing edge.
      ctx.beginPath();
      ctx.moveTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      ctx.lineTo(stroke[0].x, stroke[0].y);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // --- Controls ---

  const note = el('p', { class: 'note', role: 'status' });
  const say = (message: string, isError = false) => {
    note.textContent = message;
    note.classList.toggle('error', isError);
  };

  const shape = select<ShapeId>({
    label: 'Shape',
    options: PRESETS,
    value: 'smiley',
    onChange(id) {
      const preset = PRESETS.find((p) => p.id === id);
      if (preset) {
        setDrawing(false);
        setShape(preset.points());
        say('');
      }
    },
  });

  /** Switches the shape picker to a "Custom" entry once the user supplies an outline. */
  function useCustom(points: readonly Point[], message: string) {
    if (!shape.input.querySelector('option[value="custom"]')) {
      shape.input.append(el('option', { value: 'custom', text: 'Custom' }));
    }
    shape.input.value = 'custom';
    setShape(points);
    say(message);
  }

  const fileInput = el('input', { type: 'file', accept: '.svg,image/svg+xml' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is larger than 2 MB.');
      setDrawing(false);
      useCustom(sampleSvg(await file.text(), SAMPLES * 2), `Loaded ${file.name}.`);
    } catch (error) {
      say(error instanceof Error ? error.message : 'Could not read that file.', true);
    }
  });
  const fileButton = el('label', { class: 'file-button' }, 'Load SVG', fileInput);

  const drawButton = button('Draw', () => setDrawing(!drawing));
  drawButton.setAttribute('aria-pressed', 'false');

  function setDrawing(on: boolean) {
    if (drawing === on) return;
    drawing = on;
    stroke = [];
    strokeActive = false;
    drawButton.setAttribute('aria-pressed', String(on));
    drawButton.textContent = on ? 'Cancel' : 'Draw';
    canvas.classList.toggle('drawing', on);
    if (on) {
      loop.stop();
      say('Drag on the canvas with a mouse, pen or finger.');
    } else {
      say('');
      if (playing) loop.start();
    }
    draw();
  }

  const pointer = (event: PointerEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!drawing || !event.isPrimary) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    strokeActive = true;
    stroke = [pointer(event)];
    draw();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!strokeActive) return;
    const p = pointer(event);
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
    stroke.push(p);
    draw();
  };
  const onPointerUp = () => {
    if (!strokeActive) return;
    strokeActive = false;
    const points = stroke;
    if (points.length < 3 || pathLength(points, false) < 40) {
      stroke = [];
      say('That line was too short. Try a bigger shape.', true);
      draw();
      return;
    }
    setDrawing(false);
    useCustom(points, 'Using your drawing.');
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && drawing) setDrawing(false);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('keydown', onKeyDown);

  const circlesSlider = slider({
    label: 'Circles',
    min: 1,
    max: MAX_CIRCLES,
    value: circles,
    onInput(value) {
      circles = value;
      retrace();
      draw();
    },
  });

  const speedSlider = slider({
    label: 'Speed',
    min: 0.25,
    max: 4,
    step: 0.25,
    value: speed,
    format: (v) => `${v}×`,
    onInput: (value) => (speed = value),
  });

  let playing = !reduced;
  const playButton = button('', () => setPlaying(!playing), 'primary');
  function setPlaying(on: boolean) {
    playing = on;
    playButton.textContent = on ? 'Pause' : 'Play';
    if (on && !drawing) loop.start();
    else loop.stop();
  }
  const restartButton = button('Restart', () => {
    time = 0;
    traced = 0;
    setPlaying(true);
    draw();
  });

  panel.append(
    fieldset('Shape', shape.root, el('div', { class: 'buttons' }, fileButton, drawButton), note),
    fieldset(
      'Series',
      circlesSlider.root,
      checkbox({
        label: 'Show circles',
        checked: showCircles,
        onChange(checked) {
          showCircles = checked;
          draw();
        },
      }),
      checkbox({
        label: 'Show original outline',
        checked: showTarget,
        onChange(checked) {
          showTarget = checked;
          draw();
        },
      }),
    ),
    fieldset(
      'Playback',
      speedSlider.root,
      el('div', { class: 'buttons' }, playButton, restartButton),
    ),
  );

  about.append(
    prose(
      `The outline is sampled at ${SAMPLES} evenly spaced points and each point is read as a complex number. The discrete Fourier transform turns those samples into one coefficient per frequency.`,
    ),
    prose(
      'Each coefficient is a circle: its magnitude is the radius, its angle is the starting position, and its frequency is how many turns it makes per lap. Chained tip to tail, the last tip draws the shape.',
    ),
    prose(
      'Circles are added largest first, so a handful already gives the rough shape and the rest sharpen the corners.',
    ),
  );

  setShape(PRESETS[0].points());
  setPlaying(playing);

  return () => {
    loop.stop();
    stage.dispose();
    theme.dispose();
    document.removeEventListener('keydown', onKeyDown);
  };
}

export const fourier: Demo = {
  id: 'fourier',
  title: 'Fourier epicycles',
  summary: 'Any closed outline can be drawn by a chain of circles turning at whole-number speeds.',
  mount,
};
