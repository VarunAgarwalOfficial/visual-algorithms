import { packCells, unpackCells } from '../../core/encode';
import {
  FIELD_MAX,
  FIELD_PRESETS,
  cellShape,
  paintField,
  presetField,
  resampleField,
  type CellShape,
  type FieldPreset,
} from '../../core/geometry/field';
import { CASE_SEGMENTS, type Edge } from '../../core/marching/squares';
import type { Point } from '../../core/point';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { onDrag } from '../../ui/pointer';
import { tracePlayer } from '../../ui/player';
import { mix, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clampInt } from './points';

const SIZES = [
  { id: '12', name: '12 × 9 cells' },
  { id: '16', name: '16 × 12 cells' },
  { id: '24', name: '24 × 18 cells' },
  { id: '32', name: '32 × 24 cells' },
] as const;
type Size = (typeof SIZES)[number]['id'];

/** Mid-edge positions for the case legend, by edge: top, right, bottom, left. */
const MID: Record<Edge, [number, number]> = { 0: [0.5, 0], 1: [1, 0.5], 2: [0.5, 1], 3: [0, 0.5] };

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A height field on a grid with contour lines traced through it cell by cell.',
  );
  const url = urlState({
    preset: 'bumps',
    seed: 3,
    size: '16',
    f: '',
    levels: 5,
    focus: 3,
    lerp: true,
    saddle: true,
    bands: true,
    values: false,
    brush: 2,
    speed: 40,
  });
  const settings = url.state;
  settings.levels = clampInt(settings.levels, 1, 12);
  settings.focus = clampInt(settings.focus, 1, settings.levels);
  settings.brush = clampInt(settings.brush, 1, 5);
  settings.seed = clampInt(settings.seed, 0, 0xffffffff);
  const size = (): Size => SIZES.find((s) => s.id === settings.size)?.id ?? '16';
  const preset = (): FieldPreset =>
    FIELD_PRESETS.find((p) => p.id === settings.preset)?.id ?? 'bumps';

  let cols = Number(size());
  let rows = (cols * 3) / 4;
  let values: Uint8Array = new Uint8Array(0);
  /** Cells marched so far, row by row. */
  let position = 0;
  let hover = -1;
  let lower = false;

  const legendCanvas = el('canvas', {
    role: 'img',
    'aria-label': 'The sixteen marching squares cases, with the current one outlined.',
    style: 'display:block;width:100%;height:8.5rem',
  });
  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const legendStage = createStage(legendCanvas, () => drawLegend());
  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 1,
    maxSpeed: 2000,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      update();
    },
  });

  /** Thresholds sit at half-integers, so a contour never passes exactly through a sample. */
  const thresholds = () =>
    Array.from(
      { length: settings.levels },
      (_, i) => Math.round(((i + 1) * (FIELD_MAX + 1)) / (settings.levels + 1)) - 0.5,
    );
  const focusLevel = () => thresholds()[Math.min(settings.focus, settings.levels) - 1];

  function corners(cell: number): [number, number, number, number] {
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    const i = r * (cols + 1) + c;
    return [values[i], values[i + 1], values[i + cols + 2], values[i + cols + 1]];
  }
  const shape = (cell: number, threshold: number): CellShape =>
    cellShape(...corners(cell), threshold, settings.lerp, settings.saddle);

  function loadPreset() {
    values = presetField(preset(), cols, rows, seeded(settings.seed));
    settings.f = '';
  }
  /** A new field or new settings. `live` keeps the finished map on screen. */
  function retrace(live: boolean) {
    player.setLength(cols * rows, live ? cols * rows : 0);
    url.save();
  }

  // --- Geometry of the grid on the canvas ---

  function layout() {
    const pad = Math.max(8, stage.width * 0.025);
    const cell = Math.min((stage.width - 2 * pad) / cols, (stage.height - 2 * pad) / rows);
    return {
      cell,
      ox: (stage.width - cell * cols) / 2,
      oy: (stage.height - cell * rows) / 2,
    };
  }
  /** The cell the stepping cursor is on, or the hovered one once the map is complete. */
  const currentCell = () => (position < cols * rows ? position : hover);

  // --- Painting ---

  function paintAt(at: Point, event: PointerEvent) {
    const { cell, ox, oy } = layout();
    const sign = lower || event.shiftKey ? -1 : 1;
    paintField(
      values,
      cols,
      rows,
      (at.x - ox) / cell,
      (at.y - oy) / cell,
      settings.brush,
      sign * 5,
    );
    settings.f = packCells(values);
    retrace(true);
  }
  const stopDrag = onDrag(canvas, {
    down(at, event) {
      paintAt(at, event);
      return true;
    },
    move: paintAt,
    hover(at) {
      const { cell, ox, oy } = layout();
      const c = Math.floor((at.x - ox) / cell);
      const r = Math.floor((at.y - oy) / cell);
      const next = c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1;
      if (next === hover) return;
      hover = next;
      if (position >= cols * rows) update();
    },
  });

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { cell, ox, oy } = layout();
    const levels = thresholds();
    const focus = focusLevel();
    const done = Math.min(position, cols * rows);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';

    if (settings.bands) {
      // One translucent layer per level over the cells marched so far: higher ground gets darker.
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = Math.min(0.3, 0.75 / levels.length);
      for (const threshold of levels) {
        ctx.beginPath();
        for (let k = 0; k < done; k++) {
          const x = ox + (k % cols) * cell;
          const y = oy + Math.floor(k / cols) * cell;
          for (const polygon of shape(k, threshold).inside) {
            for (let i = 0; i < polygon.length; i += 2) {
              const px = x + polygon[i] * cell;
              const py = y + polygon[i + 1] * cell;
              if (i) ctx.lineTo(px, py);
              else ctx.moveTo(px, py);
            }
            ctx.closePath();
          }
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // The samples: a dot at every grid corner, larger and darker where the field is higher.
    const showNumbers = settings.values && cell >= 26;
    ctx.font = `${Math.min(11, Math.floor(cell * 0.36))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const v = values[r * (cols + 1) + c];
        const x = ox + c * cell;
        const y = oy + r * cell;
        if (showNumbers) {
          ctx.fillStyle = v >= focus ? palette.ink : palette.muted;
          ctx.fillText(String(v), x, y);
        } else {
          ctx.fillStyle = mix(palette.faint, palette.ink, v / FIELD_MAX);
          const radius = Math.max(0.8, Math.min(3, cell * 0.09)) * (0.6 + (0.9 * v) / FIELD_MAX);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    for (const threshold of levels) {
      const isFocus = threshold === focus;
      ctx.strokeStyle = isFocus ? palette.accent : palette.ink;
      ctx.lineWidth = isFocus ? 2.5 : 1;
      ctx.globalAlpha = isFocus ? 1 : 0.6;
      ctx.beginPath();
      for (let k = 0; k < done; k++) {
        const x = ox + (k % cols) * cell;
        const y = oy + Math.floor(k / cols) * cell;
        const { segments } = shape(k, threshold);
        for (let i = 0; i < segments.length; i += 4) {
          ctx.moveTo(x + segments[i] * cell, y + segments[i + 1] * cell);
          ctx.lineTo(x + segments[i + 2] * cell, y + segments[i + 3] * cell);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const current = currentCell();
    if (current >= 0 && current < cols * rows) {
      const x = ox + (current % cols) * cell;
      const y = oy + Math.floor(current / cols) * cell;
      ctx.strokeStyle = palette.compare;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cell, cell);
      const [tl, tr, br, bl] = corners(current);
      const mark = (cx: number, cy: number, v: number) => {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, Math.min(5, cell * 0.16)), 0, 2 * Math.PI);
        ctx.fillStyle = v >= focus ? palette.ink : palette.bg;
        ctx.fill();
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };
      if (!showNumbers) {
        mark(x, y, tl);
        mark(x + cell, y, tr);
        mark(x + cell, y + cell, br);
        mark(x, y + cell, bl);
      }
    }
    drawLegend();
  }

  function drawLegend() {
    const { ctx, width, height } = legendStage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const current = currentCell();
    const active = current >= 0 && current < cols * rows ? shape(current, focusLevel()) : undefined;
    const slotW = width / 8;
    const slotH = height / 2;
    const box = Math.min(slotW * 0.5, slotH * 0.5);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let index = 0; index < 16; index++) {
      const x = (index % 8) * slotW + (slotW - box) / 2;
      const y = Math.floor(index / 8) * slotH + (slotH - box - 12) / 2;
      const isActive = active?.index === index;
      if (isActive) {
        ctx.fillStyle = palette.compare;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x - 7, y - 7, box + 14, box + 26);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, box, box);
      // A saddle is drawn the way the current cell resolved it, else as the table lists it.
      const joined = isActive && active.joined;
      const pairs = joined ? CASE_SEGMENTS[15 - index] : CASE_SEGMENTS[index];
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [from, to] of pairs) {
        ctx.moveTo(x + MID[from][0] * box, y + MID[from][1] * box);
        ctx.lineTo(x + MID[to][0] * box, y + MID[to][1] * box);
      }
      ctx.stroke();
      [8, 4, 2, 1].forEach((bit, k) => {
        const cx = x + (k === 1 || k === 2 ? box : 0);
        const cy = y + (k >= 2 ? box : 0);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
        ctx.fillStyle = index & bit ? palette.ink : palette.bg;
        ctx.fill();
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1;
        ctx.stroke();
      });
      ctx.fillStyle = isActive ? palette.ink : palette.muted;
      ctx.fillText(String(index), x + box / 2, y + box + 5);
    }
  }

  function update() {
    draw();
    const focus = focusLevel();
    const done = Math.min(position, cols * rows);
    let segments = 0;
    let saddles = 0;
    for (let k = 0; k < done; k++) {
      const s = shape(k, focus);
      segments += s.segments.length / 4;
      if (s.index === 5 || s.index === 10) saddles++;
    }
    const current = currentCell();
    const active = current >= 0 && current < cols * rows ? shape(current, focus) : undefined;
    counters.set({
      cells: `${done} / ${cols * rows}`,
      segments,
      saddles,
      level: focus,
      index: active ? active.index : '–',
    });
    if (!active) {
      status.textContent =
        'Contour map complete. Paint on the canvas to change the field, or hover a cell to see its case.';
      return;
    }
    const [tl, tr, br, bl] = corners(current);
    const bits = [tl, tr, br, bl].map((v) => (v >= focus ? 1 : 0)).join('');
    const saddle = active.index === 5 || active.index === 10;
    status.textContent =
      `Cell ${current + 1}: corners ${tl}, ${tr}, ${br}, ${bl} against level ${focus} give bits ${bits} = case ${active.index}. ` +
      (active.index === 0 || active.index === 15
        ? 'All corners agree: no line.'
        : saddle
          ? settings.saddle
            ? `A saddle. The average ${((tl + tr + br + bl) / 4).toFixed(1)} is ${active.joined ? 'above the level: join the two high corners' : 'below the level: keep the two high corners apart'}.`
            : 'A saddle, drawn as the table lists it: the two high corners apart.'
          : `${active.segments.length / 4 === 1 ? 'One line' : 'Lines'} from the table${settings.lerp ? ', ends placed by interpolation' : ', ends at mid-edge'}.`);
  }

  const counters = stats({
    cells: 'Cells marched',
    segments: 'Segments (focus level)',
    saddles: 'Saddle cells',
    level: 'Focus level',
    index: 'Current case',
  });
  const status = el('p', { class: 'note' });

  const focusSlider = slider({
    label: 'Level in focus',
    min: 1,
    max: 12,
    value: settings.focus,
    format: (v) => `${Math.min(v, settings.levels)} of ${settings.levels}`,
    onInput(value) {
      settings.focus = Math.min(value, settings.levels);
      focusSlider.set(settings.focus);
      url.save();
      update();
    },
  });
  const toggle = (label: string, key: 'lerp' | 'saddle' | 'bands' | 'values') =>
    checkbox({
      label,
      checked: settings[key],
      onChange(on) {
        settings[key] = on;
        url.save();
        update();
      },
    });

  panel.append(
    fieldset(
      'Field',
      select<FieldPreset>({
        label: 'Preset',
        options: FIELD_PRESETS,
        value: preset(),
        onChange(id) {
          settings.preset = id;
          loadPreset();
          retrace(true);
        },
      }).root,
      select<Size>({
        label: 'Grid',
        options: SIZES,
        value: size(),
        onChange(id) {
          settings.size = id;
          const newCols = Number(id);
          const newRows = (newCols * 3) / 4;
          // A painted field is resampled; an untouched preset is simply rebuilt.
          if (settings.f) {
            values = resampleField(values, cols, rows, newCols, newRows);
            settings.f = packCells(values);
          }
          cols = newCols;
          rows = newRows;
          hover = -1;
          if (!settings.f) loadPreset();
          retrace(true);
        },
      }).root,
      slider({
        label: 'Brush size',
        min: 1,
        max: 5,
        value: settings.brush,
        format: (v) => `${v} cells`,
        onInput(value) {
          settings.brush = value;
          url.save();
        },
      }).root,
      checkbox({
        label: 'Brush lowers (or hold Shift)',
        checked: false,
        onChange(on) {
          lower = on;
        },
      }),
      el(
        'div',
        { class: 'buttons' },
        button('New noise', () => {
          settings.preset = 'noise';
          settings.seed = newSeed();
          presetSelect().value = 'noise';
          loadPreset();
          retrace(true);
        }),
        button('Reset field', () => {
          loadPreset();
          retrace(true);
        }),
      ),
      el('p', { class: 'note', text: 'Drag on the canvas to raise the field under the brush.' }),
    ),
    fieldset(
      'Contours',
      slider({
        label: 'Levels',
        min: 1,
        max: 12,
        value: settings.levels,
        onInput(value) {
          settings.levels = value;
          settings.focus = Math.min(settings.focus, value);
          focusSlider.set(settings.focus);
          url.save();
          update();
        },
      }).root,
      focusSlider.root,
      toggle('Interpolate along edges', 'lerp'),
      toggle('Resolve saddles by the cell average', 'saddle'),
      toggle('Fill bands between levels', 'bands'),
      toggle('Show heights as numbers', 'values'),
    ),
    player.root,
  );
  const presetSelect = () => panel.querySelector('select') as HTMLSelectElement;

  readout.append(
    counters.root,
    status,
    legendCanvas,
    legend([
      ['var(--canvas-accent)', 'Contour of the level in focus'],
      ['var(--canvas-ink)', 'Other levels, corner at or above the level (filled)'],
      ['var(--canvas-compare)', 'Current cell and its case'],
    ]),
  );
  about.append(
    prose(
      'Marching squares draws the contour of a height field that is only known at the corners of a grid. Each cell is handled alone. Mark each corner as at or above the level, or below it: four corners give four bits, so there are sixteen cases, and a table says which edges the contour crosses in each.',
    ),
    formula(
      'case = 8·[TL ≥ level] + 4·[TR ≥ level] + 2·[BR ≥ level] + 1·[BL ≥ level]\ncrossing on an edge from a to b:  t = (level − a) / (b − a)\ncost: one table lookup per cell per level, O(cells × levels)',
    ),
    prose(
      'Without interpolation every line ends at the middle of an edge and the contour is made of 45° steps. With it, the end slides to where the level would fall if the field changed evenly along the edge. Repeating the march for several levels gives a contour map, and filling the inside region of each level gives the bands.',
    ),
    prose(
      'Cases 5 and 10 are saddles: two opposite corners are high and two are low, and the corners alone cannot say whether the high ones are joined through the middle. The usual fix is to look at the average of the four corners. Choose the egg box preset, put the focus on the middle level and switch the saddle option off and on to see contours reconnect. Heights are whole numbers from 0 to 63 and levels sit at half values, so a contour never passes exactly through a corner.',
    ),
  );

  // --- Start ---

  const length = (cols + 1) * (rows + 1);
  if (settings.f) values = unpackCells(settings.f.slice(0, length * 2), length);
  else loadPreset();
  retrace(true);

  return () => {
    player.dispose();
    stopDrag();
    legendStage.dispose();
    stage.dispose();
    theme.dispose();
  };
};
