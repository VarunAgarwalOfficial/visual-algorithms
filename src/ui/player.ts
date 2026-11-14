import { createLoop } from './canvas';
import { button, el, fieldset, slider } from './dom';
import { prefersReducedMotion } from './theme';

/**
 * Playback controls shared by every demo. There are two kinds:
 *
 * - tracePlayer: the algorithm has already run and left a list of steps. The
 *   player owns a cursor into that list; the demo draws the state at the cursor.
 *   Pause, step, back and scrubbing are all just moving the cursor.
 * - simPlayer: a simulation that advances in time. Back is offered when the
 *   demo can snapshot and restore its state; the player keeps recent snapshots.
 *
 * Both listen for the same keys: Space or K play/pause, Right or . step,
 * Left or , back, R reset, [ and ] slower and faster.
 */

export interface Player {
  /** The "Playback" fieldset to put in the control panel. */
  root: HTMLFieldSetElement;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  dispose(): void;
}

interface Keys {
  toggle(): void;
  step(): void;
  back(): void;
  reset(): void;
  faster(direction: 1 | -1): void;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

function bindKeys(keys: Keys): () => void {
  const listener = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typingTarget(event.target)) return;
    const onButton = event.target instanceof HTMLElement && event.target.tagName === 'BUTTON';
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ((key === ' ' && !onButton) || key === 'k') keys.toggle();
    else if (key === 'ArrowRight' || key === '.') keys.step();
    else if (key === 'ArrowLeft' || key === ',') keys.back();
    else if (key === 'r') keys.reset();
    else if (key === '[') keys.faster(-1);
    else if (key === ']') keys.faster(1);
    else return;
    event.preventDefault();
  };
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}

const disable = (node: HTMLElement, off: boolean) =>
  node.setAttribute('aria-disabled', String(off));

// --- Trace playback ---

export interface TracePlayer extends Player {
  /** Number of steps applied so far, 0..length. */
  readonly position: number;
  readonly length: number;
  /** Replaces the trace: pauses, sets the length and moves to `position` (default 0). */
  setLength(length: number, position?: number): void;
  seek(position: number): void;
}

export interface TraceOptions {
  /** Draws the state after `position` steps. Called on every cursor change, at most once per frame while playing. */
  render(position: number): void;
  /** Steps per second: initial value and slider range (log scale). Defaults 8, 0.5 and 500. */
  speed?: number;
  minSpeed?: number;
  maxSpeed?: number;
  onSpeed?(stepsPerSecond: number): void;
}

export function tracePlayer(options: TraceOptions): TracePlayer {
  const min = options.minSpeed ?? 0.5;
  const max = options.maxSpeed ?? 500;
  // Slider position 0..100 maps to min..max on a log scale.
  const toSpeed = (s: number) => min * (max / min) ** (s / 100);
  const toSlider = (v: number) => (100 * Math.log(v / min)) / Math.log(max / min);
  const round = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));

  let length = 0;
  let position = 0;
  let playing = false;
  let speed = Math.max(min, Math.min(max, options.speed ?? 8));
  let budget = 0;

  const loop = createLoop((dt) => {
    budget += dt * speed;
    const whole = Math.floor(budget);
    budget -= whole;
    if (whole > 0) move(position + whole);
    if (position >= length) setPlaying(false);
  });

  const playButton = button(
    'Play',
    () => {
      if (!playing && position >= length) move(0);
      setPlaying(!playing);
    },
    'primary',
  );
  const stepButton = button('Step', () => {
    setPlaying(false);
    move(position + 1);
  });
  const backButton = button('Back', () => {
    setPlaying(false);
    move(position - 1);
  });
  const resetButton = button('Reset', () => {
    setPlaying(false);
    move(0);
  });
  const scrub = slider({
    label: 'Step',
    min: 0,
    max: 1,
    value: 0,
    format: (v) => `${v} / ${length}`,
    onInput(value) {
      setPlaying(false);
      move(value);
    },
  });
  const speedSlider = slider({
    label: 'Speed',
    min: 0,
    max: 100,
    value: toSlider(speed),
    format: (v) => `${round(toSpeed(v))} steps/s`,
    onInput(value) {
      speed = toSpeed(value);
      options.onSpeed?.(round(speed));
    },
  });

  function move(to: number) {
    position = Math.max(0, Math.min(length, Math.round(to)));
    scrub.set(position);
    disable(stepButton, position >= length);
    disable(backButton, position === 0);
    label();
    options.render(position);
  }

  function label() {
    playButton.textContent = playing
      ? 'Pause'
      : position >= length && length > 0
        ? 'Replay'
        : 'Play';
  }

  function setPlaying(on: boolean) {
    playing = on && position < length;
    budget = 0;
    if (playing) loop.start();
    else loop.stop();
    label();
  }

  const unbind = bindKeys({
    toggle: () => playButton.click(),
    step: () => stepButton.click(),
    back: () => backButton.click(),
    reset: () => resetButton.click(),
    faster(direction) {
      speedSlider.set(Math.max(0, Math.min(100, speedSlider.input.valueAsNumber + 10 * direction)));
      speed = toSpeed(speedSlider.input.valueAsNumber);
      options.onSpeed?.(round(speed));
    },
  });

  const root = fieldset(
    'Playback',
    el('div', { class: 'buttons' }, playButton, stepButton, backButton, resetButton),
    scrub.root,
    speedSlider.root,
  );

  return {
    root,
    get playing() {
      return playing;
    },
    get position() {
      return position;
    },
    get length() {
      return length;
    },
    setLength(newLength, at = 0) {
      setPlaying(false);
      length = Math.max(0, newLength);
      scrub.input.max = String(Math.max(1, length));
      move(at);
    },
    seek(to) {
      move(to);
    },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    dispose() {
      loop.stop();
      unbind();
    },
  };
}

// --- Simulation playback ---

export interface SimPlayer extends Player {
  /** Forgets the saved snapshots, for when the demo changes its state itself (new input, reset). */
  clearHistory(): void;
}

export interface SimOptions<S> {
  /**
   * Advances the simulation. Without `ticksPerSecond` it is called once per
   * frame with the elapsed seconds times the speed. With it, it is called once
   * per tick with dt = 1 / ticksPerSecond, as many times as the speed asks for.
   */
  step(dt: number): void;
  draw(): void;
  /** Supplying both enables the Back button. Snapshots must be copies. */
  snapshot?(): S;
  restore?(snapshot: S): void;
  /** How many snapshots to keep. Default 240; lower it for large states. */
  history?: number;
  /** Supplying this adds a Reset button. */
  reset?(): void;
  ticksPerSecond?: number;
  /** Speed multiplier: initial value and slider range. Defaults 1, 0.25 and 4. */
  speed?: number;
  minSpeed?: number;
  maxSpeed?: number;
  onSpeed?(speed: number): void;
  /** Start playing at once. Default: yes, unless the user prefers reduced motion. */
  autoplay?: boolean;
}

/** At most this many ticks run in one frame, so a slow step cannot freeze the page. */
const MAX_TICKS_PER_FRAME = 64;

export function simPlayer<S>(options: SimOptions<S>): SimPlayer {
  const min = options.minSpeed ?? 0.25;
  const max = options.maxSpeed ?? 4;
  const toSpeed = (s: number) => min * (max / min) ** (s / 100);
  const toSlider = (v: number) => (100 * Math.log(v / min)) / Math.log(max / min);
  const round = (v: number) => Math.round(v * 100) / 100;
  const tick = options.ticksPerSecond ? 1 / options.ticksPerSecond : 1 / 60;
  const capacity = options.history ?? 240;
  const canGoBack = Boolean(options.snapshot && options.restore);

  let playing = false;
  let speed = Math.max(min, Math.min(max, options.speed ?? 1));
  let budget = 0;
  let history: S[] = [];

  function remember() {
    if (!options.snapshot) return;
    history.push(options.snapshot());
    if (history.length > capacity) history.shift();
    disable(backButton, false);
  }

  const loop = createLoop((dt) => {
    remember();
    if (options.ticksPerSecond) {
      budget += dt * speed * options.ticksPerSecond;
      const whole = Math.min(MAX_TICKS_PER_FRAME, Math.floor(budget));
      budget -= Math.floor(budget);
      for (let i = 0; i < whole; i++) options.step(tick);
    } else {
      options.step(dt * speed);
    }
    options.draw();
  });

  const playButton = button('Play', () => setPlaying(!playing), 'primary');
  const stepButton = button('Step', () => {
    setPlaying(false);
    remember();
    options.step(tick);
    options.draw();
  });
  const backButton = button('Back', () => {
    setPlaying(false);
    const last = history.pop();
    if (last === undefined) return;
    options.restore?.(last);
    disable(backButton, history.length === 0);
    options.draw();
  });
  disable(backButton, true);
  const resetButton = button('Reset', () => {
    clearHistory();
    options.reset?.();
    options.draw();
  });
  const speedSlider = slider({
    label: 'Speed',
    min: 0,
    max: 100,
    value: toSlider(speed),
    format: (v) => `${round(toSpeed(v))}×`,
    onInput(value) {
      speed = toSpeed(value);
      options.onSpeed?.(round(speed));
    },
  });

  function clearHistory() {
    history = [];
    disable(backButton, true);
  }

  function setPlaying(on: boolean) {
    playing = on;
    budget = 0;
    playButton.textContent = on ? 'Pause' : 'Play';
    if (on) loop.start();
    else loop.stop();
  }

  const unbind = bindKeys({
    toggle: () => playButton.click(),
    step: () => stepButton.click(),
    back: () => canGoBack && backButton.click(),
    reset: () => options.reset && resetButton.click(),
    faster(direction) {
      speedSlider.set(Math.max(0, Math.min(100, speedSlider.input.valueAsNumber + 10 * direction)));
      speed = toSpeed(speedSlider.input.valueAsNumber);
      options.onSpeed?.(round(speed));
    },
  });

  const root = fieldset(
    'Playback',
    el(
      'div',
      { class: 'buttons' },
      playButton,
      stepButton,
      canGoBack && backButton,
      options.reset && resetButton,
    ),
    speedSlider.root,
  );

  setPlaying(options.autoplay ?? !prefersReducedMotion());

  return {
    root,
    get playing() {
      return playing;
    },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    clearHistory,
    dispose() {
      loop.stop();
      unbind();
    },
  };
}
