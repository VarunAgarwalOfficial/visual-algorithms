import { createBalls, fieldAt, sampleField, stepBalls, type Ball } from '../core/marching/field';
import { marchingSquares } from '../core/marching/squares';
import { createLoop, createStage } from '../ui/canvas';
import { button, checkbox, el, fieldset, slider } from '../ui/dom';
import { hexToRgb, prefersReducedMotion, watchPalette } from '../ui/theme';
import { buildLayout, prose, type Demo } from './layout';

const THRESHOLD = 1;
/** Seconds advanced by the Step button. */
const STEP_SECONDS = 1 / 12;
/** The field shading is computed on a coarser raster and scaled up. */
const SHADE_PIXEL = 4;

function mount(root: HTMLElement): () => void {
  const { canvas, panel, about } = buildLayout(
    root,
    metaballs,
    'Animation of soft blobs drifting and merging, outlined on a square grid.',
  );

  let cellSize = 24;
  let ballCount = 6;
  let interpolate = true;
  let showGrid = true;
  let showSamples = true;
  let showField = false;
  let balls: Ball[] = [];
  let segmentCount = 0;

  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d');

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, (previousWidth, previousHeight) => {
    if (previousWidth > 0 && previousHeight > 0) {
      // Keep the scene the same, proportionally: positions, speeds and sizes.
      const sx = stage.width / previousWidth;
      const sy = stage.height / previousHeight;
      const size = Math.min(stage.width, stage.height) / Math.min(previousWidth, previousHeight);
      for (const b of balls) {
        b.x *= sx;
        b.y *= sy;
        b.vx *= sx;
        b.vy *= sy;
        b.radius *= size;
      }
      stepBalls(balls, 0, stage.width, stage.height);
    }
    draw();
  });
  const loop = createLoop((dt) => {
    stepBalls(balls, dt, stage.width, stage.height);
    draw();
  });

  function reset() {
    balls = createBalls(ballCount, stage.width, stage.height, Math.random);
    draw();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);

    if (showField) drawField();

    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const grid = sampleField(balls, cols, rows, cellSize);

    if (showGrid) {
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * cellSize) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(r * cellSize) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (showSamples && cellSize >= 8) {
      // Corners inside the surface are drawn solid: these are the bits of the case index.
      const size = Math.min(5, Math.max(2, cellSize / 6));
      ctx.fillStyle = palette.ink;
      const stride = cols + 1;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          if (grid.values[r * stride + c] >= THRESHOLD) {
            ctx.fillRect(c * cellSize - size / 2, r * cellSize - size / 2, size, size);
          }
        }
      }
    }

    const segments = marchingSquares(grid, THRESHOLD, interpolate);
    segmentCount = segments.length / 4;
    ctx.beginPath();
    for (let k = 0; k < segments.length; k += 4) {
      ctx.moveTo(segments[k] * cellSize, segments[k + 1] * cellSize);
      ctx.lineTo(segments[k + 2] * cellSize, segments[k + 3] * cellSize);
    }
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    stats.textContent = `${cols} × ${rows} cells, ${segmentCount} segments`;
  }

  /** Evaluates the field per pixel (coarsely) and tints the inside: the brute-force picture. */
  function drawField() {
    if (!shadeCtx) return;
    const { ctx, width, height } = stage;
    const w = Math.ceil(width / SHADE_PIXEL);
    const h = Math.ceil(height / SHADE_PIXEL);
    if (shade.width !== w || shade.height !== h) {
      shade.width = w;
      shade.height = h;
    }
    const image = shadeCtx.createImageData(w, h);
    const [r, g, b] = hexToRgb(theme.palette.accent);
    let i = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const f = fieldAt(balls, (x + 0.5) * SHADE_PIXEL, (y + 0.5) * SHADE_PIXEL);
        image.data[i++] = r;
        image.data[i++] = g;
        image.data[i++] = b;
        // Outside, the tint fades with the field so the falloff is visible.
        image.data[i++] = f >= THRESHOLD ? 70 : Math.round(55 * f * f);
      }
    }
    shadeCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, 0, 0, w * SHADE_PIXEL, h * SHADE_PIXEL);
  }

  // --- Controls ---

  const stats = el('p', { class: 'note' });
  const redraw =
    <T>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      draw();
    };

  let playing = !prefersReducedMotion();
  const playButton = button('', () => setPlaying(!playing), 'primary');
  const stepButton = button('Step', () => {
    setPlaying(false);
    stepBalls(balls, STEP_SECONDS, stage.width, stage.height);
    draw();
  });
  function setPlaying(on: boolean) {
    playing = on;
    playButton.textContent = on ? 'Pause' : 'Play';
    if (on) loop.start();
    else loop.stop();
  }

  panel.append(
    fieldset(
      'Grid',
      slider({
        label: 'Cell size',
        min: 4,
        max: 80,
        step: 2,
        value: cellSize,
        format: (v) => `${v} px`,
        onInput: redraw((v) => (cellSize = v)),
      }).root,
      checkbox({
        label: 'Interpolate crossings',
        checked: interpolate,
        onChange: redraw((v) => (interpolate = v)),
      }),
      checkbox({ label: 'Show grid', checked: showGrid, onChange: redraw((v) => (showGrid = v)) }),
      checkbox({
        label: 'Show inside corners',
        checked: showSamples,
        onChange: redraw((v) => (showSamples = v)),
      }),
      checkbox({
        label: 'Show field',
        checked: showField,
        onChange: redraw((v) => (showField = v)),
      }),
      stats,
    ),
    fieldset(
      'Balls',
      slider({
        label: 'Count',
        min: 1,
        max: 12,
        value: ballCount,
        onInput(value) {
          ballCount = value;
          reset();
        },
      }).root,
      button('Shuffle', reset),
    ),
    fieldset('Playback', el('div', { class: 'buttons' }, playButton, stepButton)),
  );

  about.append(
    prose(
      'Each ball adds `r² / d²` to a field, where `d` is the distance to its centre. The surface is where the field equals 1. One ball alone gives its own circle; close balls add up and flow together.',
    ),
    prose(
      'Marching squares only samples the field at grid corners. The four corners of a cell are inside or outside, which gives 16 cases, and a lookup table says which edges the outline crosses.',
    ),
    prose(
      'Without interpolation each crossing sits at the middle of its edge. With it, the crossing slides to where a straight line between the two corner values would reach 1. Raise the cell size to see the difference.',
    ),
  );

  reset();
  setPlaying(playing);

  return () => {
    loop.stop();
    stage.dispose();
    theme.dispose();
  };
}

export const metaballs: Demo = {
  id: 'metaballs',
  title: 'Metaballs',
  summary: 'Blobs that merge as they meet, outlined by marching squares on a coarse grid.',
  mount,
};
