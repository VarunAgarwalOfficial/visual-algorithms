import { seeded, type Random } from '../../core/random';
import type { StepFrame } from '../../core/structures/trace';
import { createLoop, createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer, type TracePlayer } from '../../ui/player';
import { prefersReducedMotion, watchPalette } from '../../ui/theme';
import { buildLayout, type DemoEntry, type DemoLayout } from '../layout';
import type { Gfx, Point } from './draw';

/** The recorded frames for a list of operations; starts[i] is the first frame of operation i. */
export interface Recording<F> {
  frames: F[];
  starts: number[];
}

/** Runs `apply` for each operation against a structure that appends to `frames`. */
export function record<F>(
  frames: F[],
  ops: readonly string[],
  apply: (op: string) => void,
): Recording<F> {
  const starts: number[] = [];
  for (const op of ops) {
    starts.push(frames.length);
    apply(op);
  }
  return { frames, starts };
}

/** Adds a frame that repeats the last state under a new caption, for an operation that was turned away. */
export function refuse<F extends StepFrame>(frames: F[], caption: string) {
  frames.push({ ...frames[frames.length - 1], caption, hi: new Map() } as F);
}

export interface OpsDemoOptions<F extends StepFrame> {
  root: HTMLElement;
  entry: DemoEntry;
  canvasLabel: string;
  /** The URL-backed settings; `ops` is the operation list joined with dots. */
  settings: { ops: string; seed: number; speed: number };
  save(): void;
  maxOps?: number;
  /** Returns the canonical form of one operation token, or null when it is not valid. */
  clean(op: string): string | null;
  /** Words for an operation, e.g. "insert 5". */
  describe(op: string): string;
  /** Builds the structure from scratch and performs every operation. */
  run(ops: readonly string[]): Recording<F>;
  draw(frame: F, g: Gfx): void;
  /** Updates counters and notes for the frame on screen. */
  show?(frame: F, last: F): void;
  /**
   * What the caption says before the reader has done anything: the example is
   * already built, so it describes what is there and says nothing has run yet.
   */
  intro?(): string;
}

export interface OpsDemo {
  layout: DemoLayout;
  player: TracePlayer;
  /** Status line, operation label and notices, for the readout. */
  status: HTMLElement;
  /** Undo and Clear. */
  history: HTMLFieldSetElement;
  ops(): readonly string[];
  /** Appends operations, then plays the first new one. Returns false if nothing valid was added. */
  push(...ops: string[]): boolean;
  /** Replaces the whole list and shows the result. */
  replace(ops: readonly string[]): void;
  /** Re-runs everything after a setting changed, keeping the view at the end. */
  rebuild(): void;
  /** Rewrites the caption and counters, for when the intro's words depend on a control. */
  refresh(): void;
  /** A generator that differs for every button press but is fixed by the URL. */
  random(): Random;
  redraw(): void;
  dispose(): void;
}

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * The machinery every structure demo shares: an operation list kept in the
 * URL, one long trace covering every operation since the start, a status line,
 * and short position tweens between frames.
 */
export function opsDemo<F extends StepFrame>(o: OpsDemoOptions<F>): OpsDemo {
  const layout = buildLayout(o.root, o.entry, o.canvasLabel);
  const maxOps = o.maxOps ?? 120;
  const { settings } = o;
  settings.speed = Math.max(0.5, Math.min(60, settings.speed || 3));
  settings.seed = Math.max(0, Math.min(999_999_999, Math.round(settings.seed)));

  let ops: string[] = parse(settings.ops);
  let recording: Recording<F> = { frames: [], starts: [] };
  let current = 0;
  /** True until the reader acts: the caption then introduces the example instead of replaying its last step. */
  let untouched = true;

  function parse(text: string): string[] {
    const out: string[] = [];
    for (const token of text.slice(0, 4000).split('.')) {
      const op = token ? o.clean(token) : null;
      if (op !== null && out.length < maxOps) out.push(op);
    }
    return out;
  }

  // --- Tweening ---

  const reduced = prefersReducedMotion();
  let from = new Map<string | number, Point>();
  const shown = new Map<string | number, Point>();
  let progress = 1;
  let duration = 0.25;
  const tween = createLoop((dt) => {
    progress = Math.min(1, progress + dt / duration);
    draw();
    if (progress >= 1) tween.stop();
  });

  const theme = watchPalette(() => draw());
  const stage = createStage(layout.canvas, () => {
    progress = 1;
    draw();
  });

  function draw() {
    const frame = recording.frames[current];
    if (!frame) return;
    const t = ease(progress);
    const moving = progress < 1;
    const before = from;
    shown.clear();
    stage.ctx.clearRect(0, 0, stage.width, stage.height);
    o.draw(frame, {
      ctx: stage.ctx,
      width: stage.width,
      height: stage.height,
      palette: theme.palette,
      place(id, x, y) {
        const start = moving ? before.get(id) : undefined;
        const at = start
          ? { x: start.x + (x - start.x) * t, y: start.y + (y - start.y) * t }
          : { x, y };
        shown.set(id, at);
        return at;
      },
    });
  }

  // --- Playback ---

  // Two lines are reserved for the caption so the page does not jump as it changes.
  const caption = el('p', {
    class: 'note',
    'aria-live': 'polite',
    style: 'min-height: 2.9em; color: inherit',
  });
  const which = el('p', { class: 'note' });
  const notice = el('p', { class: 'note error', style: 'min-height: 0' });
  const status = el(
    'div',
    { style: 'flex: 1 1 100%; display: grid; gap: 0.35rem' },
    caption,
    which,
    notice,
  );

  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 0.5,
    maxSpeed: 60,
    onSpeed(value) {
      settings.speed = value;
      o.save();
    },
    render(position) {
      if (position < recording.frames.length - 1) untouched = false;
      const next = Math.min(position, recording.frames.length - 1);
      const changed = next !== current;
      current = next;
      if (changed && !reduced && settings.speed <= 24 && shown.size > 0) {
        from = new Map(shown);
        progress = 0;
        duration = Math.max(0.08, Math.min(0.32, 0.7 / settings.speed));
        tween.start();
      } else if (changed) {
        progress = 1;
      }
      update();
    },
  });

  function update() {
    const frame = recording.frames[current];
    if (!frame) return;
    draw();
    caption.textContent = frame.caption;
    const { starts } = recording;
    let index = -1;
    while (index + 1 < starts.length && starts[index + 1] <= current) index++;
    if (untouched && ops.length > 0) {
      caption.textContent =
        o.intro?.() ??
        'Nothing has run yet. The picture shows a ready-made example, built by the operations listed below. Use the box under the picture to make the next change and watch it happen step by step.';
      which.textContent = `The example was built by: ${ops.map(o.describe).join(', ')}.`;
    } else
      which.textContent =
        ops.length === 0
          ? 'No operations yet.'
          : index < 0
            ? `Start, before the first of ${ops.length} operations.`
            : `Operation ${index + 1} of ${ops.length}: ${o.describe(ops[index])}.`;
    o.show?.(frame, recording.frames[recording.frames.length - 1]);
    // Until the reader acts there is nothing of theirs to replay, so the playback buttons wait.
    player.root.style.display = untouched && ops.length > 0 ? 'none' : '';
  }

  /** Re-records everything. `at` is the frame to show: undefined means the last one. */
  function rerun(at?: number) {
    recording = o.run(ops);
    settings.ops = ops.join('.');
    o.save();
    const length = recording.frames.length - 1;
    current = -1;
    player.setLength(length, at ?? length);
  }

  const history = fieldset(
    'History',
    el(
      'div',
      { class: 'buttons' },
      button('Undo last', () => {
        if (ops.length === 0) return;
        untouched = false;
        notice.textContent = '';
        ops = ops.slice(0, -1);
        rerun();
      }),
      button('Clear', () => {
        untouched = false;
        notice.textContent = '';
        ops = [];
        rerun();
      }),
    ),
  );

  rerun();

  return {
    layout,
    player,
    status,
    history,
    ops: () => ops,
    push(...added) {
      const valid = added.map((op) => o.clean(op)).filter((op): op is string => op !== null);
      if (valid.length === 0) return false;
      untouched = false;
      const room = maxOps - ops.length;
      if (room <= 0) {
        notice.textContent = `This demo keeps at most ${maxOps} operations. Undo or clear to go on.`;
        return false;
      }
      notice.textContent = '';
      const first = ops.length;
      ops = [...ops, ...valid.slice(0, room)];
      recording = o.run(ops);
      settings.ops = ops.join('.');
      o.save();
      const length = recording.frames.length - 1;
      if (reduced) {
        player.setLength(length, length);
      } else {
        // Show the state just before the new operation without a tween, then play it.
        current = -1;
        player.setLength(length, Math.min(length, recording.starts[first]));
        player.play();
      }
      return true;
    },
    replace(next) {
      untouched = false;
      notice.textContent = '';
      ops = parse(next.join('.'));
      rerun();
    },
    rebuild: () => rerun(),
    refresh: () => update(),
    random: () => seeded((Math.imul(settings.seed + 1, 1_000_003) + ops.length * 7919) >>> 0),
    redraw: draw,
    dispose() {
      tween.stop();
      player.dispose();
      stage.dispose();
      theme.dispose();
    },
  };
}

// --- Controls shared by several demos ---

export interface Action {
  name: string;
  /** Returns false when the text was not usable, which keeps it in the box. */
  run(text: string): boolean;
}

/** A text box with buttons. Enter runs the first action. */
export function opForm(options: {
  label: string;
  placeholder?: string;
  maxLength?: number;
  numeric?: boolean;
  /** Starting text. When given, the text stays in the box after an action. */
  value?: string;
  /** Called after an action succeeds, e.g. to suggest the next value. */
  after?(input: HTMLInputElement): void;
  actions: readonly Action[];
}): { root: HTMLElement; input: HTMLInputElement } {
  const field = textInput({
    label: options.label,
    value: options.value ?? '',
    maxLength: options.maxLength,
    placeholder: options.placeholder,
    onChange: () => field.input.removeAttribute('aria-invalid'),
  });
  if (options.numeric) field.input.inputMode = 'numeric';
  const run = (action: Action) => {
    if (!action.run(field.input.value.trim())) field.input.setAttribute('aria-invalid', 'true');
    else {
      if (options.value === undefined) field.input.value = '';
      options.after?.(field.input);
    }
  };
  field.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run(options.actions[0]);
  });
  const buttons = el(
    'div',
    { class: 'buttons' },
    ...options.actions.map((action, i) =>
      button(action.name, () => run(action), i === 0 ? 'primary' : ''),
    ),
  );
  return { root: el('div', {}, field.root, buttons), input: field.input };
}

/** A fieldset holding a demo's first action; the layout moves it straight under the picture. */
export function actFieldset(legend: string, ...children: (Node | string)[]): HTMLFieldSetElement {
  const field = fieldset(legend, ...children);
  field.classList.add('act');
  return field;
}

/** Parses a whole number in [lo, hi], or null. */
export function wholeNumber(text: string, lo: number, hi: number): number | null {
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n >= lo && n <= hi ? n : null;
}

/** A drop-down that loads a ready-made operation list. */
export function presetSelect(
  demo: OpsDemo,
  presets: readonly { name: string; ops: string | (() => string) }[],
  label = 'Load an example',
): HTMLElement {
  const field = select({
    label,
    options: [
      { id: '', name: 'Choose…' },
      ...presets.map((p, i) => ({ id: String(i), name: p.name })),
    ],
    value: '',
    onChange(id) {
      const preset = presets[Number(id)];
      if (id !== '' && preset) {
        demo.replace((typeof preset.ops === 'string' ? preset.ops : preset.ops()).split('.'));
      }
      field.input.value = '';
    },
  });
  return field.root;
}

export interface KeyOps {
  /** Largest key allowed; keys are whole numbers from 0. */
  maxKey: number;
  /** Keys in the structure after every operation, for picking random deletes and finds. */
  keys(): number[];
  /** The most keys the demo holds; random inserts stop short of it. */
  maxKeys: number;
  findName?: string;
}

/** clean/describe for demos whose operations are insert, delete and find on a number. */
export function keyOpCodec(maxKey: number, findWord = 'find') {
  return {
    clean(op: string): string | null {
      const match = /^([idf])(\d{1,4})$/.exec(op);
      if (!match || Number(match[2]) > maxKey) return null;
      return `${match[1]}${Number(match[2])}`;
    },
    describe(op: string): string {
      const word = op[0] === 'i' ? 'insert' : op[0] === 'd' ? 'delete' : findWord;
      return `${word} ${op.slice(1)}`;
    },
  };
}

/** The "Operations" fieldset for insert / delete / find on a number, and a "More operations" one with random helpers. */
export function keyOpsFieldset(
  demo: OpsDemo,
  options: KeyOps,
  ...extra: (Node | null)[]
): DocumentFragment {
  const { maxKey } = options;
  const act = (code: string) => (text: string) => {
    const n = wholeNumber(text, 0, maxKey);
    return n !== null && demo.push(`${code}${n}`);
  };
  const fresh = (random: Random, taken: Set<number>): number => {
    for (let tries = 0; tries < 50; tries++) {
      const key = 1 + Math.floor(random() * maxKey);
      if (!taken.has(key)) return key;
    }
    return 1 + Math.floor(random() * maxKey);
  };
  /** A key worth trying next: one that falls between two keys near the middle, so it travels a long way. */
  const suggest = (): number => {
    const keys = [...options.keys()].sort((a, b) => a - b);
    const taken = new Set(keys);
    if (keys.length >= 2) {
      const mid = keys.length >> 1;
      const between = Math.round((keys[mid - 1] + keys[mid]) / 2);
      if (!taken.has(between)) return between;
      for (let i = 1; i < keys.length; i++) {
        const gap = Math.round((keys[i - 1] + keys[i]) / 2);
        if (!taken.has(gap)) return gap;
      }
    }
    return fresh(demo.random(), taken);
  };
  const form = opForm({
    label: `Key: a whole number from 0 to ${maxKey}`,
    numeric: true,
    maxLength: 4,
    actions: [
      { name: 'Insert', run: act('i') },
      { name: 'Delete', run: act('d') },
      { name: options.findName ?? 'Find', run: act('f') },
    ],
    after(input) {
      input.value = String(suggest());
    },
  });
  form.input.value = String(suggest());
  const field = fieldset('Operations', form.root);
  const more = fieldset(
    'More operations',
    el(
      'div',
      { class: 'buttons' },
      button('Insert 10 random', () => {
        const random = demo.random();
        const taken = new Set(options.keys());
        const added: string[] = [];
        // At the limit, one insert still goes through so its caption can say why nothing was added.
        const count = Math.max(1, Math.min(10, options.maxKeys - taken.size));
        for (let i = 0; i < count; i++) {
          const key = fresh(random, taken);
          taken.add(key);
          added.push(`i${key}`);
        }
        demo.push(...added);
      }),
      button('Random operation', () => {
        const random = demo.random();
        const keys = options.keys();
        const roll = random();
        const existing = keys.length > 0 ? keys[Math.floor(random() * keys.length)] : undefined;
        const full = keys.length >= options.maxKeys;
        if (existing === undefined || (roll < 0.5 && !full))
          demo.push(`i${fresh(random, new Set(keys))}`);
        else if (roll < 0.75) demo.push(`d${existing}`);
        else demo.push(`f${random() < 0.7 ? existing : fresh(random, new Set(keys))}`);
      }),
    ),
    ...extra,
  );
  // The key box is the first thing to try, so it goes under the picture; the rest waits in settings.
  field.classList.add('act');
  const both = document.createDocumentFragment();
  both.append(field, more);
  return both;
}
