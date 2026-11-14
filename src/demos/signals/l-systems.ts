import {
  MAX_RULE_LENGTH,
  cleanSymbols,
  expand,
  parseRules,
  turtle,
  type Expansion,
  type TurtlePath,
} from '../../core/signals/lsystem';
import { createStage } from '../../ui/canvas';
import { el, fieldset, select, slider, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { prefersReducedMotion, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { FONT } from '../../ui/font';

interface Preset {
  id: string;
  name: string;
  axiom: string;
  rules: string;
  angle: number;
  heading: number;
  iterations: number;
}

const PRESETS: readonly Preset[] = [
  {
    id: 'koch',
    name: 'Koch snowflake',
    axiom: 'F++F++F',
    rules: 'F=F-F++F-F',
    angle: 60,
    heading: 0,
    iterations: 4,
  },
  {
    id: 'sierpinski',
    name: 'Sierpinski triangle',
    axiom: 'F-G-G',
    rules: 'F=F-G+F+G-F; G=GG',
    angle: 120,
    heading: 0,
    iterations: 5,
  },
  {
    id: 'dragon',
    name: 'Dragon curve',
    axiom: 'F',
    rules: 'F=F+G; G=F-G',
    angle: 90,
    heading: 0,
    iterations: 11,
  },
  {
    id: 'hilbert',
    name: 'Hilbert curve',
    axiom: 'A',
    rules: 'A=+BF-AFA-FB+; B=-AF+BFB+FA-',
    angle: 90,
    heading: 0,
    iterations: 5,
  },
  {
    id: 'gosper',
    name: 'Gosper curve',
    axiom: 'F',
    rules: 'F=F-G--G+F++FF+G-; G=+F-GG--G-F++F+G',
    angle: 60,
    heading: 0,
    iterations: 4,
  },
  {
    id: 'plant',
    name: 'Plant (brackets)',
    axiom: 'X',
    rules: 'X=F+[[X]-X]-F[-FX]+X; F=FF',
    angle: 25,
    heading: 75,
    iterations: 5,
  },
  {
    id: 'penrose',
    name: 'Penrose tiling',
    axiom: '[X]++[X]++[X]++[X]++[X]',
    rules:
      'W=YF++ZF----XF[-YF----WF]++; X=+YF--ZF[---WF--XF]+; Y=-WF++XF[+++YF++ZF]-; Z=--YF++++WF[+ZF++++XF]--XF; F=',
    angle: 36,
    heading: 0,
    iterations: 4,
  },
];

const MAX_SYMBOLS = 120_000;
const MAX_SEGMENTS = 60_000;
const MAX_ITERATIONS = 14;
const MAX_AXIOM = 60;
const MAX_RULES_TEXT = 400;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Line drawing traced by a turtle that follows the symbols of an L-system string.',
  );

  // -1 means "whatever the preset says", so links to presets stay short.
  const url = urlState({
    preset: 'koch',
    axiom: '',
    rules: '',
    angle: -1,
    head: -1,
    iter: -1,
    speed: 400,
  });
  const settings = url.state;
  const startPreset = PRESETS.find((p) => p.id === settings.preset);
  const base = startPreset ?? PRESETS[0];
  const custom = settings.preset === 'custom';
  if (!custom && !startPreset) settings.preset = base.id;

  let axiom = custom ? cleanSymbols(settings.axiom, MAX_AXIOM) || base.axiom : base.axiom;
  let rulesText = custom ? settings.rules.slice(0, MAX_RULES_TEXT) : base.rules;
  let angle = settings.angle < 0 ? base.angle : clamp(Math.round(settings.angle * 2) / 2, 1, 180);
  let heading = settings.head < 0 ? base.heading : clamp(Math.round(settings.head), 0, 359);
  let iterations =
    settings.iter < 0 ? base.iterations : clamp(Math.round(settings.iter), 0, MAX_ITERATIONS);

  let rules = parseRules(rulesText).rules;
  let expansion: Expansion = { text: '', lengths: [0], truncated: false };
  let path: TurtlePath = turtle('', 60);
  let clipped = false;

  // Screen-space paths, rebuilt when the geometry changes.
  let full: Path2D | undefined;
  let done = new Path2D();
  let doneCount = 0;
  let fit = { scale: 1, ox: 0, oy: 0 };

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => {
    layout();
    draw();
  });
  const player = tracePlayer({
    speed: clamp(settings.speed, 1, 20000),
    minSpeed: 1,
    maxSpeed: 20000,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => update(),
  });

  // --- Model ---

  function save() {
    const preset = PRESETS.find((p) => p.id === settings.preset);
    settings.axiom = preset ? '' : axiom;
    settings.rules = preset ? '' : rulesText;
    settings.angle = preset && preset.angle === angle ? -1 : angle;
    settings.head = preset && preset.heading === heading ? -1 : heading;
    settings.iter = preset && preset.iterations === iterations ? -1 : iterations;
    url.save();
  }

  /** Expands and walks the string again. `animate` restarts the drawing from nothing. */
  function rebuild(animate: boolean) {
    expansion = expand(axiom, rules, iterations, MAX_SYMBOLS);
    path = turtle(expansion.text, angle, heading, MAX_SEGMENTS);
    clipped = path.count >= MAX_SEGMENTS;
    layout();
    growth.textContent = `Symbols per generation: ${expansion.lengths.map((n) => n.toLocaleString('en-GB')).join(', ')}.`;
    save();
    if (animate && !prefersReducedMotion() && path.count > 0) {
      player.setLength(path.count, 0);
      player.play();
    } else {
      player.setLength(path.count, path.count);
    }
  }

  function layout() {
    const { width, height } = stage;
    const pad = Math.max(10, Math.min(width, height) * 0.05);
    const w = path.maxX - path.minX || 1;
    const h = path.maxY - path.minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    fit = {
      scale,
      ox: width / 2 - ((path.minX + path.maxX) / 2) * scale,
      oy: height / 2 + ((path.minY + path.maxY) / 2) * scale,
    };
    full = undefined;
    done = new Path2D();
    doneCount = 0;
  }

  function addSegments(target: Path2D, from: number, to: number) {
    const s = path.segments;
    const { scale, ox, oy } = fit;
    for (let i = from; i < to; i++) {
      const k = i * 4;
      const joined = i > from && s[k] === s[k - 2] && s[k + 1] === s[k - 1];
      if (!joined) target.moveTo(ox + s[k] * scale, oy - s[k + 1] * scale);
      target.lineTo(ox + s[k + 2] * scale, oy - s[k + 3] * scale);
    }
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    if (path.count === 0) {
      ctx.fillStyle = palette.muted;
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Nothing to draw: the string has no F or G.', width / 2, height / 2);
      return;
    }
    const position = player.position;
    if (!full) {
      full = new Path2D();
      addSegments(full, 0, path.count);
    }
    if (position < doneCount) {
      done = new Path2D();
      doneCount = 0;
    }
    addSegments(done, doneCount, position);
    doneCount = position;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    if (position < path.count) {
      ctx.strokeStyle = palette.faint;
      ctx.stroke(full);
    }
    ctx.lineWidth = fit.scale > 6 ? 1.75 : 1.25;
    ctx.strokeStyle = palette.accent;
    ctx.stroke(position >= path.count ? full : done);

    if (position > 0 && position < path.count) {
      const k = (position - 1) * 4;
      ctx.fillStyle = palette.change;
      ctx.beginPath();
      ctx.arc(
        fit.ox + path.segments[k + 2] * fit.scale,
        fit.oy - path.segments[k + 3] * fit.scale,
        3.5,
        0,
        2 * Math.PI,
      );
      ctx.fill();
    }
  }

  function update() {
    draw();
    const position = player.position;
    const lengths = expansion.lengths;
    const generation = lengths.length - 1;
    const last = lengths[generation];
    const factor =
      generation > 0 && lengths[generation - 1] > 0 ? last / lengths[generation - 1] : 1;
    counters.set({
      generation,
      symbols: last.toLocaleString('en-GB'),
      growth: `×${factor.toFixed(2)}`,
      segments: `${position.toLocaleString('en-GB')} / ${path.count.toLocaleString('en-GB')}`,
    });
    const notes: string[] = [];
    if (expansion.truncated) {
      notes.push(
        `Stopped at generation ${generation}: the next one would pass ${MAX_SYMBOLS.toLocaleString('en-GB')} symbols.`,
      );
    }
    if (clipped)
      notes.push(`Only the first ${MAX_SEGMENTS.toLocaleString('en-GB')} steps are drawn.`);
    const what =
      path.count === 0
        ? 'The string has no drawing symbols.'
        : position === 0
          ? 'Ready. The turtle is at the start.'
          : position >= path.count
            ? 'The turtle has read the whole string.'
            : `The turtle is drawing step ${position} of ${path.count}.`;
    status.textContent = [what, ...notes].join(' ');
  }

  // --- Controls ---

  const counters = stats({
    generation: 'Generation',
    symbols: 'Symbols',
    growth: 'Growth',
    segments: 'Steps drawn',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const growth = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const problem = el('p', { class: 'note error', role: 'status' });
  problem.hidden = true;
  const complain = (text: string) => {
    problem.textContent = text;
    problem.hidden = !text;
  };

  function useCustom() {
    if (!presetSelect.input.querySelector('option[value="custom"]')) {
      presetSelect.input.append(el('option', { value: 'custom', text: 'Custom' }));
    }
    presetSelect.input.value = 'custom';
    settings.preset = 'custom';
  }

  const presetSelect = select({
    label: 'System',
    options: PRESETS,
    value: custom ? PRESETS[0].id : base.id,
    onChange(id) {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return; // "Custom" keeps what is in the boxes
      settings.preset = preset.id;
      axiom = preset.axiom;
      rulesText = preset.rules;
      rules = parseRules(rulesText).rules;
      angle = preset.angle;
      heading = preset.heading;
      iterations = preset.iterations;
      axiomInput.input.value = axiom;
      rulesInput.input.value = rulesText;
      angleSlider.set(angle);
      headingSlider.set(heading);
      iterationSlider.set(iterations);
      complain('');
      rebuild(true);
    },
  });
  if (custom) useCustom();

  const axiomInput = textInput({
    label: 'Axiom',
    value: axiom,
    maxLength: MAX_AXIOM,
    onChange(value) {
      const cleaned = cleanSymbols(value, MAX_AXIOM);
      if (!cleaned) {
        complain('The axiom needs at least one symbol.');
        return;
      }
      complain(
        cleaned.length < value.replace(/\s/g, '').length
          ? 'Unknown symbols in the axiom were ignored.'
          : '',
      );
      axiom = cleaned;
      useCustom();
      rebuild(false);
    },
  });
  const rulesInput = textInput({
    label: 'Rules (separate with ;)',
    value: rulesText,
    maxLength: MAX_RULES_TEXT,
    placeholder: 'F=F+F--F+F; G=GG',
    onChange(value) {
      const parsed = parseRules(value);
      if (parsed.error) {
        complain(parsed.error);
        return;
      }
      complain('');
      rulesText = value;
      rules = parsed.rules;
      useCustom();
      rebuild(false);
    },
  });
  const angleSlider = slider({
    label: 'Turn angle',
    min: 1,
    max: 180,
    step: 0.5,
    value: angle,
    format: (v) => `${v}°`,
    onInput(value) {
      angle = value;
      rebuild(false);
    },
  });
  const headingSlider = slider({
    label: 'Start direction',
    min: 0,
    max: 345,
    step: 15,
    value: heading,
    format: (v) => `${v}°`,
    onInput(value) {
      heading = value;
      rebuild(false);
    },
  });
  const iterationSlider = slider({
    label: 'Generations',
    min: 0,
    max: MAX_ITERATIONS,
    value: iterations,
    onInput(value) {
      iterations = value;
      rebuild(false);
    },
  });

  panel.append(
    fieldset(
      'L-system',
      presetSelect.root,
      axiomInput.root,
      rulesInput.root,
      problem,
      iterationSlider.root,
      angleSlider.root,
      headingSlider.root,
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    growth,
    legend([
      ['var(--canvas-accent)', 'Drawn'],
      ['var(--canvas-faint)', 'Still to draw'],
      ['var(--canvas-change)', 'Turtle'],
    ]),
  );

  about.append(
    prose(
      'An L-system is a string and a set of rewrite rules. Each generation replaces every symbol at once by the right-hand side of its rule; symbols without a rule stay as they are. Lindenmayer invented them in 1968 to describe how plants grow.',
    ),
    formula(
      'axiom  F++F++F          rule  F → F-F++F-F\ngen 1  F-F++F-F++F-F++F-F++F-F++F-F\nlength after n generations: 3·4ⁿ drawing steps',
    ),
    prose(
      'A turtle then reads the string. `F` and `G` draw one step forwards, `f` moves without drawing, `+` and `-` turn left and right by the angle, `|` turns around. `[` remembers the position and direction on a stack and `]` goes back to it, which is how branches are made. Any other letter or digit does nothing when drawn: it only steers the rewriting.',
    ),
    prose(
      `The string grows geometrically, so the work is proportional to its final length. To keep the page responsive a run stops before ${MAX_SYMBOLS.toLocaleString('en-GB')} symbols, each rule is at most ${MAX_RULE_LENGTH} symbols, and the drawing is scaled to fit the canvas.`,
    ),
  );

  rebuild(true);

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
