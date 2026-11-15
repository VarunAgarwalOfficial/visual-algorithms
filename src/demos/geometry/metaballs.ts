import { createBalls, fieldAt, sampleField, stepBalls, type Ball } from '../../core/marching/field';
import { marchingSquares } from '../../core/marching/squares';
import { adaptiveContour } from '../../core/marching/adaptive';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, prose, type Mount } from '../layout';

const THRESHOLD = 1;
/** The adaptive variant starts from cells this many halvings coarser than the cell size. */
const ADAPTIVE_LEVELS = 3;
/** The field shading is computed on a coarser raster and scaled up. */
const SHADE_PIXEL = 4;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Animation of soft blobs drifting and merging, outlined on a square grid.',
  );

  const url = urlState({
    cell: 24,
    balls: 6,
    seed: 7,
    adaptive: false,
    lerp: true,
    grid: true,
    corners: true,
    field: false,
  });
  const settings = url.state;
  settings.cell = Math.max(4, Math.min(80, Math.round(settings.cell)));
  settings.balls = Math.max(1, Math.min(12, Math.round(settings.balls)));
  let balls: Ball[] = [];
  let moved = false;
  const status = el('p', { class: 'note' });
  readout.append(status);
  const showStatus = () => {
    status.textContent = moved
      ? `The ${balls.length} balls are drifting. Where two come close their outlines join into one blob, and they part again as they separate. Pause to look at one moment.`
      : `Nothing has run yet. Each of the ${balls.length} balls has a soft pull that fades with distance, and the outline marks where the pulls add up to exactly 1. The dots are grid corners that fall inside. Press Play to set the balls drifting.`;
  };

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

  function reset() {
    balls = createBalls(settings.balls, stage.width, stage.height, seeded(settings.seed));
    moved = false;
    player?.clearHistory();
    draw();
    showStatus();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);

    if (settings.field) drawField();

    const cellSize = settings.cell;
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const uniformSamples = (cols + 1) * (rows + 1);
    let segments: number[];
    let scale = cellSize;

    ctx.strokeStyle = palette.faint;
    ctx.fillStyle = palette.ink;
    ctx.lineWidth = 1;
    const dot = Math.min(5, Math.max(2, cellSize / 6));

    if (settings.adaptive) {
      const result = adaptiveContour(
        (x, y) => fieldAt(balls, x, y),
        width,
        height,
        cellSize,
        ADAPTIVE_LEVELS,
        THRESHOLD,
        settings.lerp,
      );
      segments = result.segments;
      scale = 1;
      if (settings.grid) {
        // The quadtree itself: big squares where nothing happens, small ones along the outline.
        ctx.beginPath();
        for (let k = 0; k < result.leaves.length; k += 3) {
          ctx.rect(
            Math.round(result.leaves[k]) + 0.5,
            Math.round(result.leaves[k + 1]) + 0.5,
            result.leaves[k + 2],
            result.leaves[k + 2],
          );
        }
        ctx.stroke();
      }
      if (settings.corners && cellSize >= 8) {
        for (let k = 0; k < result.samples.length; k += 3) {
          if (result.samples[k + 2] >= THRESHOLD) {
            ctx.fillRect(result.samples[k] - dot / 2, result.samples[k + 1] - dot / 2, dot, dot);
          }
        }
      }
      const used = result.samples.length / 3;
      stats.textContent = `${used} samples instead of ${uniformSamples} (${Math.round(
        (100 * used) / uniformSamples,
      )}%), ${segments.length / 4} segments`;
    } else {
      const grid = sampleField(balls, cols, rows, cellSize);
      if (settings.grid) {
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
        ctx.stroke();
      }
      if (settings.corners && cellSize >= 8) {
        // Corners inside the surface are drawn solid: these are the bits of the case index.
        const stride = cols + 1;
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            if (grid.values[r * stride + c] >= THRESHOLD) {
              ctx.fillRect(c * cellSize - dot / 2, r * cellSize - dot / 2, dot, dot);
            }
          }
        }
      }
      segments = marchingSquares(grid, THRESHOLD, settings.lerp);
      stats.textContent = `${uniformSamples} samples, ${segments.length / 4} segments`;
    }

    ctx.beginPath();
    for (let k = 0; k < segments.length; k += 4) {
      ctx.moveTo(segments[k] * scale, segments[k + 1] * scale);
      ctx.lineTo(segments[k + 2] * scale, segments[k + 3] * scale);
    }
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
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
  const toggle = (label: string, key: 'adaptive' | 'lerp' | 'grid' | 'corners' | 'field') =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        url.save();
        draw();
      },
    });

  const player = simPlayer<Ball[]>({
    step: (dt) => {
      moved = true;
      stepBalls(balls, dt, stage.width, stage.height);
    },
    draw: () => {
      draw();
      showStatus();
    },
    snapshot: () => balls.map((b) => ({ ...b })),
    restore: (saved) => (balls = saved),
    reset,
  });

  panel.append(
    fieldset(
      'Grid',
      slider({
        label: 'Cell size',
        min: 4,
        max: 80,
        step: 2,
        value: settings.cell,
        format: (v) => `${v} px`,
        onInput(value) {
          settings.cell = value;
          url.save();
          draw();
        },
      }).root,
      toggle('Adaptive sampling (quadtree)', 'adaptive'),
      toggle('Interpolate crossings', 'lerp'),
      toggle('Show grid', 'grid'),
      toggle('Show inside corners', 'corners'),
      toggle('Show field', 'field'),
      stats,
    ),
    fieldset(
      'Balls',
      slider({
        label: 'Count',
        min: 1,
        max: 12,
        value: settings.balls,
        onInput(value) {
          settings.balls = value;
          url.save();
          reset();
        },
      }).root,
      button('Shuffle', () => {
        settings.seed = newSeed();
        url.save();
        reset();
      }),
    ),
    player.root,
  );

  about.append(
    prose(
      'Each ball adds `r² / d²` to a field, where `d` is the distance to its centre. The surface is where the field equals 1. One ball alone gives its own circle; close balls add up and flow together.',
    ),
    prose(
      'Marching squares only samples the field at grid corners. The four corners of a cell are inside or outside, which gives 16 cases, and a lookup table says which edges the outline crosses.',
    ),
    prose(
      'The adaptive variant does not sample every corner. It starts from cells eight times larger and splits a cell in four only when its corners or its centre disagree about being inside, so the samples crowd along the outline and the empty and full areas are skipped. The readout shows how many samples that saves.',
    ),
    prose(
      'Without interpolation each crossing sits at the middle of its edge. With it, the crossing slides to where a straight line between the two corner values would reach 1. Raise the cell size to see the difference.',
    ),
  );

  reset();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
