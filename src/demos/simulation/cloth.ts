import {
  MAX_CUTS,
  createCloth,
  cutCloth,
  nearestParticle,
  packCuts,
  stepCloth,
  unpackCuts,
  type Cloth,
  type ClothParams,
  type ClothPreset,
} from '../../core/sim/cloth';
import type { Point } from '../../core/point';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { mix, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clamp, clampInt, every, fit, meter, oneOf, short, toWorld } from './common';

/** The area is the same whatever the canvas, so a link starts the same cloth everywhere. */
const WIDTH = 800;
const HEIGHT = 600;
const PRESETS = ['cloth', 'rope', 'soft-body'] as const;
const TOOLS = ['drag', 'cut'] as const;
const SHADES = 6;
const DAMPING = 0.008;
/** A link this far past its rest length (as a share of it) gets the strongest colour. */
const STRAIN_SPAN = 0.4;

interface Saved {
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pinned: Uint8Array;
  alive: Uint8Array;
  strain: Float32Array;
  worst: number;
  time: number;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A hanging sheet of cloth drawn as a mesh of short links, coloured by how far each is stretched.',
  );

  const url = urlState({
    preset: 'cloth',
    cols: 36,
    iter: 8,
    gravity: 900,
    wind: 0,
    tear: true,
    tearAt: 2.5,
    strain: true,
    tool: 'drag',
    released: '',
    cuts: '',
  });
  const settings = url.state;
  settings.preset = oneOf(settings.preset, PRESETS);
  settings.tool = oneOf(settings.tool, TOOLS);
  settings.cols = clampInt(settings.cols, 6, 56);
  settings.iter = clampInt(settings.iter, 1, 40);
  settings.gravity = clampInt(settings.gravity, 0, 2000);
  settings.wind = clampInt(settings.wind, -800, 800);
  settings.tearAt = clamp(settings.tearAt, 1.2, 4);

  let cloth: Cloth = createCloth('cloth', 6, WIDTH, HEIGHT);
  /** Links cut by hand, as constraint indices, so a link reproduces them. */
  let cuts = new Set<number>();
  let worst = 1;
  let grab: { index: number; x: number; y: number } | undefined;
  let knife: Point | undefined;
  const timer = meter();
  const due = every(120);

  const params = (): ClothParams => ({
    gravity: settings.gravity,
    wind: settings.wind,
    iterations: settings.iter,
    damping: DAMPING,
    tear: settings.tear,
    tearAt: settings.tearAt,
  });

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  /** Pins released by hand, as particle indices, so a link reproduces them. */
  function releasedPins(): number[] {
    return settings.released
      .split(',')
      .filter((part) => part !== '')
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0)
      .slice(0, 64);
  }

  function reset() {
    cloth = createCloth(settings.preset as ClothPreset, settings.cols, WIDTH, HEIGHT);
    for (const i of releasedPins()) if (i < cloth.n) cloth.pinned[i] = 0;
    cuts = new Set(unpackCuts(settings.cuts, cloth.constraints));
    for (const k of cuts) cloth.alive[k] = 0;
    worst = 1;
    grab = undefined;
    knife = undefined;
    timer.reset();
    player?.clearHistory();
    draw();
  }

  function rebuild() {
    settings.released = '';
    settings.cuts = '';
    url.save();
    reset();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const view = fit(stage, cloth.width, HEIGHT);
    const s = view.scale;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);

    // The floor and the side walls.
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, HEIGHT * s - 0.5);
    ctx.lineTo(cloth.width * s - 0.5, HEIGHT * s - 0.5);
    ctx.lineTo(cloth.width * s - 0.5, 0);
    ctx.stroke();

    // Links, one path per strain shade.
    const span = STRAIN_SPAN;
    let alive = 0;
    ctx.lineWidth = cloth.n < 200 ? 2 : 1;
    for (let shade = 0; shade < SHADES; shade++) {
      ctx.strokeStyle = settings.strain
        ? mix(palette.accent, palette.change, shade / (SHADES - 1))
        : palette.ink;
      ctx.beginPath();
      for (let k = 0; k < cloth.constraints; k++) {
        if (!cloth.alive[k]) continue;
        const t = clamp((cloth.strain[k] - 1) / span, 0, 0.999);
        if (Math.floor(t * SHADES) !== shade) continue;
        alive++;
        ctx.moveTo(cloth.x[cloth.a[k]] * s, cloth.y[cloth.a[k]] * s);
        ctx.lineTo(cloth.x[cloth.b[k]] * s, cloth.y[cloth.b[k]] * s);
      }
      ctx.stroke();
    }

    if (cloth.n <= 120) {
      ctx.fillStyle = palette.ink;
      for (let i = 0; i < cloth.n; i++) {
        ctx.beginPath();
        ctx.arc(cloth.x[i] * s, cloth.y[i] * s, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Pins.
    ctx.fillStyle = palette.ink;
    const pin = Math.max(5, 7 * s);
    for (let i = 0; i < cloth.n; i++) {
      if (cloth.pinned[i]) {
        ctx.fillRect(cloth.x[i] * s - pin / 2, cloth.y[i] * s - pin / 2, pin, pin);
      }
    }
    if (grab) {
      ctx.strokeStyle = palette.compare;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(grab.x * s, grab.y * s, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (due(!player?.playing)) {
      counters.set({
        particles: short(cloth.n),
        links: short(alive),
        broken: short(cloth.constraints - alive),
        work: short(alive * settings.iter),
        strain: `${worst.toFixed(2)}×`,
        ms: timer.ms.toFixed(3),
      });
      status.textContent = `Each step: one Verlet move for ${cloth.n} particles, then ${settings.iter} relaxation ${
        settings.iter === 1 ? 'pass' : 'passes'
      } over ${alive} links. The most stretched link is at ${worst.toFixed(2)} times its rest length.`;
    }
  }

  // --- Pointer: drag a particle, click a pin to release it, or cut ---

  const world = (point: Point) => toWorld(fit(stage, cloth.width, HEIGHT), point);
  const undrag = onDrag(canvas, {
    down(point, event) {
      const at = world(point);
      if (settings.tool === 'cut' || event.shiftKey) {
        knife = at;
        return true;
      }
      const index = nearestParticle(cloth, at.x, at.y, 28 / fit(stage, cloth.width, HEIGHT).scale);
      if (index < 0) return false;
      if (cloth.pinned[index]) {
        cloth.pinned[index] = 0;
        settings.released = [...releasedPins(), index].slice(-64).join(',');
        url.save();
        player.clearHistory();
        draw();
        return false;
      }
      grab = { index, x: at.x, y: at.y };
      return true;
    },
    move(point) {
      const at = world(point);
      if (knife) {
        const removed: number[] = [];
        if (cutCloth(cloth, knife.x, knife.y, at.x, at.y, removed) > 0) {
          for (const k of removed) cuts.add(k);
          settings.cuts = packCuts(cuts);
          url.save();
          // Back must not bring a cut link back while the link says it is cut.
          player.clearHistory();
          if (!player.playing) draw();
        }
        knife = at;
      } else if (grab) {
        grab.x = clamp(at.x, 0, cloth.width);
        grab.y = clamp(at.y, 0, HEIGHT);
        if (!player.playing) {
          // Paused: move the particle anyway so the drag is visible.
          cloth.x[grab.index] = cloth.px[grab.index] = grab.x;
          cloth.y[grab.index] = cloth.py[grab.index] = grab.y;
          draw();
        }
      }
    },
    up() {
      grab = undefined;
      knife = undefined;
      draw();
    },
  });

  // --- Controls ---

  const counters = stats({
    particles: 'Particles',
    links: 'Links',
    broken: 'Broken',
    work: 'Corrections per step',
    strain: 'Worst stretch',
    ms: 'Step, ms',
  });
  const status = el('p', { class: 'note' });

  type NumberKey = 'iter' | 'gravity' | 'wind' | 'tearAt';
  const live = (
    label: string,
    key: NumberKey,
    min: number,
    max: number,
    step: number,
    format?: (v: number) => string,
  ) =>
    slider({
      label,
      min,
      max,
      step,
      value: settings[key],
      format,
      onInput(value) {
        settings[key] = value;
        url.save();
        draw();
      },
    }).root;
  type FlagKey = 'tear' | 'strain';
  const flag = (label: string, key: FlagKey) =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        url.save();
        draw();
      },
    });

  const player = simPlayer<Saved>({
    step(dt) {
      worst = timer.time(() => stepCloth(cloth, params(), dt, grab));
    },
    draw,
    snapshot: () => ({
      x: cloth.x.slice(),
      y: cloth.y.slice(),
      px: cloth.px.slice(),
      py: cloth.py.slice(),
      pinned: cloth.pinned.slice(),
      alive: cloth.alive.slice(),
      strain: cloth.strain.slice(),
      worst,
      time: cloth.time,
    }),
    restore(saved) {
      if (saved.x.length !== cloth.n) return;
      cloth.x.set(saved.x);
      cloth.y.set(saved.y);
      cloth.px.set(saved.px);
      cloth.py.set(saved.py);
      cloth.pinned.set(saved.pinned);
      cloth.alive.set(saved.alive);
      cloth.strain.set(saved.strain);
      worst = saved.worst;
      cloth.time = saved.time;
      grab = undefined;
    },
    history: 180,
    reset,
    ticksPerSecond: 60,
  });

  panel.append(
    fieldset(
      'Solver',
      live('Relaxation passes', 'iter', 1, 40, 1),
      flag('Colour links by stretch', 'strain'),
      flag('Tear when stretched', 'tear'),
      live('Tears at', 'tearAt', 1.2, 4, 0.1, (v) => `${v.toFixed(1)}× rest`),
    ),
    fieldset(
      'Forces',
      live('Gravity', 'gravity', 0, 2000, 50),
      live('Wind', 'wind', -800, 800, 50),
    ),
    fieldset(
      'Shape',
      select({
        label: 'Preset',
        options: [
          { id: 'cloth', name: 'Hanging cloth' },
          { id: 'rope', name: 'Rope' },
          { id: 'soft-body', name: 'Soft body' },
        ],
        value: settings.preset as (typeof PRESETS)[number],
        onChange(value) {
          settings.preset = value;
          rebuild();
        },
      }).root,
      slider({
        label: 'Resolution',
        min: 6,
        max: 56,
        value: settings.cols,
        onInput(value) {
          settings.cols = value;
          rebuild();
        },
      }).root,
      select({
        label: 'Pointer',
        options: [
          { id: 'drag', name: 'Drag (Shift-drag cuts)' },
          { id: 'cut', name: 'Cut' },
        ],
        value: settings.tool as (typeof TOOLS)[number],
        onChange(value) {
          settings.tool = value;
          url.save();
        },
      }).root,
      button('Mend and re-pin', rebuild),
      el('p', {
        class: 'note',
        text: `Click a square pin to release it. The link keeps released pins and up to ${MAX_CUTS} cut links, and applies them to the cloth at rest. It does not keep tears or where you dragged the cloth.`,
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-accent)', 'Link at rest length'],
      ['var(--canvas-change)', 'Link stretched by 40% or more'],
      ['var(--canvas-ink)', 'Pin'],
    ]),
  );

  about.append(
    prose(
      'The cloth is a grid of particles. Position Verlet stores no velocity: it keeps each particle’s previous position, and the difference between the two is the velocity. One step moves a particle as far as it moved last time, plus the acceleration.',
    ),
    formula("x' = 2x − x_prev + a·dt²        (then x_prev = x)"),
    prose(
      'The links are not springs. After the move, each link looks at its two ends and shifts them straight back to its rest length, half each, or all on the free end if the other is pinned. Fixing one link disturbs the ones next to it, so the pass is repeated. This is relaxation, the same idea as Gauss-Seidel: each pass spreads the correction one link further. Few passes give stretchy cloth, many give stiff cloth, and the cost is passes times links.',
    ),
    prose(
      'Because positions are corrected directly and the velocity is only implied, the corrections cannot overshoot and blow up the way stiff springs with explicit Euler do. That is why this is the usual method for cloth, ropes and rag dolls in games. Tearing is one line: a link stretched past the limit is removed. The soft body is the same solver with diagonal links added to resist shear.',
    ),
  );

  reset();

  return () => {
    undrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
