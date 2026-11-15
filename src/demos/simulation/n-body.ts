import {
  addBody,
  createBodies,
  createQuadtree,
  directAccelerations,
  kineticEnergy,
  loadPreset,
  momentum,
  potentialEnergy,
  stepEuler,
  stepLeapfrog,
  treeAccelerations,
  treeForce,
  type NBodyPreset,
} from '../../core/sim/nbody';
import type { Point } from '../../core/point';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clamp, clampInt, every, meter, oneOf, short } from './common';

/** The view shows x in -2..2 and y in -1.5..1.5. */
const VIEW_WIDTH = 4;
const VIEW_HEIGHT = 3;
const MAX_BODIES = 3000;
const MAX_ADDED = 16;
const PRESETS = ['galaxy', 'clusters', 'two-body', 'binary-planet', 'figure-eight'] as const;
const INTEGRATORS = ['leapfrog', 'euler'] as const;
/** Launch speed per unit of drag length. */
const LAUNCH = 1.6;

interface Saved {
  n: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  m: Float64Array;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Bodies orbiting under gravity, with the squares of a quadtree drawn over them.',
  );

  const url = urlState({
    preset: 'galaxy',
    n: 800,
    theta: -1,
    soft: -1,
    dt: 0.01,
    method: 'leapfrog',
    brute: false,
    tree: true,
    used: true,
    trails: false,
    mass: 0.05,
    sel: 1,
    seed: 3,
    added: '',
  });
  const settings = url.state;
  settings.preset = oneOf(settings.preset, PRESETS);
  settings.method = oneOf(settings.method, INTEGRATORS);
  settings.n = clampInt(settings.n, 100, MAX_BODIES);
  settings.theta = settings.theta < 0 ? -1 : clamp(settings.theta, 0, 1.5);
  settings.soft = settings.soft < 0 ? -1 : clamp(settings.soft, 0, 0.1);
  settings.dt = clamp(settings.dt, 0.001, 0.03);
  settings.mass = clamp(settings.mass, 0.001, 1);
  settings.sel = clampInt(settings.sel, 0, MAX_BODIES + MAX_ADDED);

  const bodies = createBodies(MAX_BODIES + MAX_ADDED);
  const tree = createQuadtree();
  /** Bodies launched by hand, as x, y, vx, vy, m; kept in the URL. */
  let added: number[] = parseAdded(settings.added);
  let softening = 0;
  /** Opening angle in use: the URL's, or the preset's own when the URL leaves it out. */
  let theta = 0.7;
  let terms = 0;
  let energyStart = 0;
  let energyNow = 0;
  let launch: { from: Point; to: Point } | undefined;
  const timer = meter();
  const due = every(120);
  const energyDue = every(500);

  // Trails: a ring of recent positions per body.
  let trailLength = 0;
  let trail = new Float32Array(0);
  let trailHead = 0;
  let trailCount = 0;

  function parseAdded(text: string): number[] {
    const values = text
      .split(',')
      .map(Number)
      .filter((v) => Number.isFinite(v));
    const out: number[] = [];
    for (let k = 0; k + 4 < values.length && out.length < MAX_ADDED * 5; k += 5) {
      out.push(
        clamp(values[k], -4, 4),
        clamp(values[k + 1], -4, 4),
        clamp(values[k + 2], -10, 10),
        clamp(values[k + 3], -10, 10),
        clamp(values[k + 4], 0.001, 1),
      );
    }
    return out;
  }

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const scale = () => Math.min(stage.width / VIEW_WIDTH, stage.height / VIEW_HEIGHT);
  const toScreen = (x: number, y: number): Point => ({
    x: stage.width / 2 + x * scale(),
    y: stage.height / 2 + y * scale(),
  });
  const toWorld = (p: Point): Point => ({
    x: (p.x - stage.width / 2) / scale(),
    y: (p.y - stage.height / 2) / scale(),
  });

  const usesTree = () => !settings.brute;

  /** Fills the accelerations for the current positions and returns the force terms it took. */
  function accelerate(): number {
    return usesTree()
      ? treeAccelerations(tree, bodies, theta, softening)
      : directAccelerations(bodies, softening);
  }

  function energy(): number {
    return kineticEnergy(bodies) + potentialEnergy(bodies, softening);
  }

  /** Call after any change that is not a time step: new bodies, restored state, new parameters. */
  function refresh(rebase: boolean) {
    terms = accelerate();
    energyNow = energy();
    if (rebase) energyStart = energyNow;
  }

  function clearTrails() {
    trailLength = clampInt(Math.floor(30000 / Math.max(1, bodies.n)), 4, 700);
    const size = bodies.n * trailLength * 2;
    if (trail.length !== size) trail = new Float32Array(size);
    trailHead = 0;
    trailCount = 0;
  }

  function recordTrail() {
    for (let i = 0; i < bodies.n; i++) {
      const at = (i * trailLength + trailHead) * 2;
      trail[at] = bodies.x[i];
      trail[at + 1] = bodies.y[i];
    }
    trailHead = (trailHead + 1) % trailLength;
    trailCount = Math.min(trailLength, trailCount + 1);
  }

  function reset() {
    const preset = settings.preset as NBodyPreset;
    const suggested = loadPreset(bodies, preset, settings.n, seeded(settings.seed));
    for (let k = 0; k < added.length; k += 5) {
      addBody(bodies, added[k], added[k + 1], added[k + 2], added[k + 3], added[k + 4]);
    }
    softening = settings.soft < 0 ? suggested : settings.soft;
    // A few bodies are cheap to sum exactly, and the choreographies need it.
    const few = preset !== 'galaxy' && preset !== 'clusters';
    theta = settings.theta < 0 ? (few ? 0 : 0.7) : settings.theta;
    thetaSlider?.set(theta);
    softSlider?.set(softening);
    timer.reset();
    clearTrails();
    refresh(true);
    player?.clearHistory();
    draw();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const s = scale();
    ctx.clearRect(0, 0, width, height);
    const selected = settings.sel < bodies.n ? settings.sel : -1;

    if (settings.tree && usesTree() && tree.nodes > 0) {
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let node = 0; node < tree.nodes; node++) {
        const side = tree.half[node] * 2 * s;
        if (side < 3) continue;
        const corner = toScreen(tree.cx[node] - tree.half[node], tree.cy[node] - tree.half[node]);
        ctx.rect(corner.x, corner.y, side, side);
      }
      ctx.stroke();
    }

    let usedNodes = 0;
    let usedBodies = 0;
    if (settings.used && usesTree() && selected >= 0 && tree.nodes > 0) {
      // Re-run the walk for one body and draw what its force was summed from.
      const used: number[] = [];
      treeForce(tree, bodies, selected, theta, softening, used);
      const from = toScreen(bodies.x[selected], bodies.y[selected]);
      ctx.lineWidth = 1;
      ctx.fillStyle = palette.compare;
      ctx.strokeStyle = palette.compare;
      for (const item of used) {
        if (item < 0) {
          usedBodies++;
          continue;
        }
        usedNodes++;
        const side = tree.half[item] * 2 * s;
        const corner = toScreen(tree.cx[item] - tree.half[item], tree.cy[item] - tree.half[item]);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(corner.x, corner.y, side, side);
        ctx.globalAlpha = 0.7;
        ctx.strokeRect(corner.x + 0.5, corner.y + 0.5, side, side);
      }
      // Each node acts from its centre of mass.
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (const item of used) {
        if (item < 0) continue;
        const com = toScreen(tree.comX[item], tree.comY[item]);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(com.x, com.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.good;
      ctx.beginPath();
      for (const item of used) {
        if (item >= 0) continue;
        const at = toScreen(bodies.x[-item - 1], bodies.y[-item - 1]);
        ctx.moveTo(at.x + 4, at.y);
        ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    if (settings.trails && trailCount > 1) {
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.globalAlpha = bodies.n > 50 ? 0.45 : 0.9;
      ctx.beginPath();
      const first = (trailHead - trailCount + trailLength) % trailLength;
      for (let i = 0; i < bodies.n; i++) {
        for (let k = 0; k < trailCount; k++) {
          const at = (i * trailLength + ((first + k) % trailLength)) * 2;
          const x = width / 2 + trail[at] * s;
          const y = height / 2 + trail[at + 1] * s;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Light bodies as squares in one go; heavy ones as discs.
    const dot = bodies.n > 400 ? 2 : 3;
    ctx.fillStyle = palette.ink;
    for (let i = 0; i < bodies.n; i++) {
      if (bodies.m[i] >= 0.05) continue;
      const x = width / 2 + bodies.x[i] * s;
      const y = height / 2 + bodies.y[i] * s;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.fillStyle = palette.accent;
    for (let i = 0; i < bodies.n; i++) {
      if (bodies.m[i] < 0.05) continue;
      const at = toScreen(bodies.x[i], bodies.y[i]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, clamp(2 + Math.cbrt(bodies.m[i]) * 4, 2.5, 7), 0, Math.PI * 2);
      ctx.fill();
    }

    if (selected >= 0) {
      const at = toScreen(bodies.x[selected], bodies.y[selected]);
      ctx.strokeStyle = palette.change;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (launch) {
      ctx.strokeStyle = palette.change;
      ctx.fillStyle = palette.change;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(launch.from.x, launch.from.y);
      ctx.lineTo(launch.to.x, launch.to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(launch.from.x, launch.from.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (due(!player?.playing)) {
      if (energyDue(!player?.playing || bodies.n <= 600)) energyNow = energy();
      const p = momentum(bodies);
      const drift = energyStart !== 0 ? (energyNow - energyStart) / Math.abs(energyStart) : 0;
      const brute = bodies.n * (bodies.n - 1);
      counters.set({
        bodies: short(bodies.n),
        terms: short(terms),
        brute: short(brute),
        energy: energyNow.toFixed(4),
        drift: `${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(3)}%`,
        momentum: Math.hypot(p.x, p.y).toExponential(1),
        ms: timer.ms.toFixed(2),
      });
      const how = !usesTree()
        ? `Direct sum: every body adds up the pull of all ${bodies.n - 1} others.`
        : theta === 0
          ? 'θ = 0: no node is ever far enough, so the tree is opened down to single bodies. Same answer as the direct sum.'
          : `Barnes-Hut with θ = ${theta}: a square narrower than θ times its distance counts as one mass.`;
      const detail =
        usesTree() && settings.used && selected >= 0
          ? ` The marked body's force is ${usedNodes + usedBodies} terms (${usedNodes} squares, ${usedBodies} single bodies) instead of ${bodies.n - 1}.`
          : '';
      status.textContent = player?.started
        ? how + detail
        : `Nothing has run yet. Each dot is a star, and every star pulls on every other one by gravity. Press Play to set them moving, or click a star to mark it.`;
    }
  }

  // --- Pointer: click picks a body, drag launches a new one ---

  let pressed: Point | undefined;
  const undrag = onDrag(canvas, {
    down(point) {
      pressed = point;
      return true;
    },
    move(point) {
      if (!pressed) return;
      if (launch || Math.hypot(point.x - pressed.x, point.y - pressed.y) > 6) {
        launch = { from: pressed, to: point };
        if (!player.playing) draw();
      }
    },
    up(point) {
      if (!pressed) return;
      if (launch) {
        const from = toWorld(launch.from);
        const to = toWorld(launch.to);
        const body = [
          from.x,
          from.y,
          (to.x - from.x) * LAUNCH,
          (to.y - from.y) * LAUNCH,
          settings.mass,
        ];
        if (
          added.length < MAX_ADDED * 5 &&
          addBody(bodies, body[0], body[1], body[2], body[3], body[4]) >= 0
        ) {
          // Remember it as launched, so the link and Reset bring it back.
          added.push(...body.map((v) => Math.round(v * 1000) / 1000));
          settings.added = added.join(',');
          settings.sel = bodies.n - 1;
          url.save();
          player.clearHistory();
          clearTrails();
          refresh(true);
          note.textContent = `${added.length / 5} of ${MAX_ADDED} launched bodies used.`;
        } else {
          note.textContent = `No room: at most ${MAX_ADDED} launched bodies.`;
        }
        launch = undefined;
      } else {
        // A plain click: mark the nearest body.
        let best = -1;
        let bestD = 18 * 18;
        for (let i = 0; i < bodies.n; i++) {
          const at = toScreen(bodies.x[i], bodies.y[i]);
          const d = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best >= 0) {
          settings.sel = best;
          url.save();
        }
      }
      pressed = undefined;
      draw();
    },
  });

  // --- Controls ---

  const counters = stats({
    bodies: 'Bodies',
    terms: 'Force terms per step',
    brute: 'Direct sum n(n−1)',
    energy: 'Total energy',
    drift: 'Energy drift',
    momentum: 'Momentum |p|',
    ms: 'Step, ms',
  });
  const status = el('p', { class: 'note' });
  const note = el('p', {
    class: 'note',
    text: 'Drag on the canvas to launch a body. Click a body to mark it.',
  });

  type FlagKey = 'brute' | 'tree' | 'used' | 'trails';
  const flag = (label: string, key: FlagKey) =>
    checkbox({
      label,
      checked: settings[key],
      onChange(checked) {
        settings[key] = checked;
        url.save();
        if (key === 'brute') {
          timer.reset();
          refresh(false);
        }
        if (key === 'trails') clearTrails();
        draw();
      },
    });

  const softSlider = slider({
    label: 'Softening',
    min: 0,
    max: 0.1,
    step: 0.005,
    value: 0,
    onInput(value) {
      settings.soft = value;
      softening = value;
      url.save();
      refresh(true);
      draw();
    },
  });

  const player = simPlayer<Saved>({
    step() {
      const advance = settings.method === 'euler' ? stepEuler : stepLeapfrog;
      terms = timer.time(() => advance(bodies, settings.dt, accelerate));
      if (settings.trails) recordTrail();
    },
    draw,
    snapshot: () => ({
      n: bodies.n,
      x: bodies.x.slice(0, bodies.n),
      y: bodies.y.slice(0, bodies.n),
      vx: bodies.vx.slice(0, bodies.n),
      vy: bodies.vy.slice(0, bodies.n),
      m: bodies.m.slice(0, bodies.n),
    }),
    restore(saved) {
      bodies.n = saved.n;
      bodies.x.set(saved.x);
      bodies.y.set(saved.y);
      bodies.vx.set(saved.vx);
      bodies.vy.set(saved.vy);
      bodies.m.set(saved.m);
      clearTrails();
      refresh(false);
    },
    history: 120,
    reset,
    ticksPerSecond: 60,
  });

  const countSlider = slider({
    label: 'Bodies (galaxy, clusters)',
    min: 100,
    max: MAX_BODIES,
    step: 100,
    value: settings.n,
    onInput(value) {
      settings.n = value;
      url.save();
      if (settings.preset === 'galaxy' || settings.preset === 'clusters') reset();
    },
  });

  const thetaSlider = slider({
    label: 'Opening angle θ',
    min: 0,
    max: 1.5,
    step: 0.05,
    value: 0.7,
    onInput(value) {
      settings.theta = value;
      theta = value;
      url.save();
      timer.reset();
      refresh(false);
      draw();
    },
  });

  const trailsBox = flag('Trails', 'trails');

  panel.append(
    fieldset(
      'Start',
      select({
        label: 'Arrangement',
        options: [
          { id: 'galaxy', name: 'Galaxy disc' },
          { id: 'clusters', name: 'Two colliding clusters' },
          { id: 'two-body', name: 'Two-body orbit' },
          { id: 'binary-planet', name: 'Binary and a planet' },
          { id: 'figure-eight', name: 'Figure-eight three-body' },
        ],
        value: settings.preset as (typeof PRESETS)[number],
        onChange(value) {
          settings.preset = value;
          settings.soft = -1;
          settings.sel = 1;
          added = [];
          settings.added = '';
          // The small systems are best seen with their paths.
          settings.trails = value !== 'galaxy' && value !== 'clusters';
          settings.theta = -1;
          const box = trailsBox.querySelector('input');
          if (box) box.checked = settings.trails;
          url.save();
          reset();
        },
      }).root,
      countSlider.root,
      slider({
        label: 'Mass of a launched body',
        min: 0.001,
        max: 1,
        step: 0.001,
        value: settings.mass,
        onInput(value) {
          settings.mass = value;
          url.save();
        },
      }).root,
      el(
        'div',
        { class: 'buttons' },
        button('Shuffle', () => {
          settings.seed = newSeed();
          url.save();
          reset();
        }),
        button('Remove launched', () => {
          added = [];
          settings.added = '';
          url.save();
          reset();
        }),
      ),
      note,
    ),
    fieldset(
      'Forces',
      thetaSlider.root,
      flag('Direct sum (no tree)', 'brute'),
      flag('Show quadtree', 'tree'),
      flag('Show what the marked body sums', 'used'),
      softSlider.root,
    ),
    fieldset(
      'Integration',
      select({
        label: 'Method',
        options: [
          { id: 'leapfrog', name: 'Leapfrog (velocity Verlet)' },
          { id: 'euler', name: 'Euler' },
        ],
        value: settings.method as (typeof INTEGRATORS)[number],
        onChange(value) {
          settings.method = value;
          url.save();
        },
      }).root,
      slider({
        label: 'Time step',
        min: 0.001,
        max: 0.03,
        step: 0.001,
        value: settings.dt,
        onInput(value) {
          settings.dt = value;
          url.save();
        },
      }).root,
    ),
    fieldset('Display', trailsBox),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-change)', 'Marked body'],
      ['var(--canvas-compare)', 'Squares used as one mass'],
      ['var(--canvas-good)', 'Bodies summed one by one'],
      ['var(--canvas-accent)', 'Heavy bodies'],
    ]),
  );

  about.append(
    prose(
      'Every body pulls on every other, so the direct sum costs `n(n−1)` force terms per step. Barnes-Hut builds a quadtree over the bodies each step: the square holding them all is split in four until each leaf holds one body, and every square records the total mass and centre of mass of what is inside it.',
    ),
    prose(
      'To get the force on one body, walk down from the root. If a square of width `s` is at distance `d` and `s / d < θ`, it is far enough to count as a single mass at its centre of mass. Otherwise open it and look at its four children. Nearby bodies end up summed one by one and distant crowds as a handful of squares, about `log n` terms per body. With `θ = 0` nothing is ever far enough and the result is the exact sum. Larger `θ` is faster and rougher.',
    ),
    formula(
      'a_i = Σ m_j (x_j − x_i) / (|x_j − x_i|² + ε²)^(3/2)\n\nleapfrog:  v += a·dt/2;  x += v·dt;  a = forces(x);  v += a·dt/2\nEuler:     x += v·dt;    v += a·dt',
    ),
    prose(
      'Euler uses the old velocity for the whole step, so an orbit spirals outwards and the total energy climbs without limit. Leapfrog costs the same one force evaluation per step but is time-reversible and symplectic: its energy error wobbles and stays bounded. Try the two-body orbit with each method and watch the drift counter. Momentum is conserved exactly by the direct sum, since each pair gets equal and opposite pulls; Barnes-Hut breaks that slightly, which the momentum counter shows. Softening `ε` stops close passes from giving huge kicks.',
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
