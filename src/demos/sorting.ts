import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../core/sorting/algorithms';
import { INPUT_KINDS, makeInput, type InputKind } from '../core/sorting/inputs';
import { applyStep, replay, tally, type Counts, type Step } from '../core/sorting/trace';
import { createLoop, createStage } from '../ui/canvas';
import { button, el, fieldset, select, slider } from '../ui/dom';
import { watchPalette } from '../ui/theme';
import { buildLayout, prose, type Demo } from './layout';

const MAX_STEPS_PER_SECOND = 2000;

/** Maps the 0..100 speed slider to steps per second on a log scale (1 to 2000). */
const stepsPerSecond = (slider: number) => Math.round(MAX_STEPS_PER_SECOND ** (slider / 100));

function describe(step: Step | undefined): string {
  if (!step) return 'Ready.';
  if (step.type === 'compare') return `Compare positions ${step.i + 1} and ${step.j + 1}.`;
  if (step.type === 'swap') return `Swap positions ${step.i + 1} and ${step.j + 1}.`;
  return `Write ${step.value} to position ${step.i + 1}.`;
}

function mount(root: HTMLElement): () => void {
  const { canvas, panel, about } = buildLayout(
    root,
    sorting,
    'Bar chart of the array being sorted. The bars in use are highlighted.',
  );

  let algorithmId: AlgorithmId = 'quick';
  let inputKind: InputKind = 'random';
  let size = 48;
  let speed = 45;

  let input: number[] = [];
  let steps: Step[] = [];
  let array: number[] = [];
  let cursor = 0; // number of steps applied
  let counts: Counts = { comparisons: 0, swaps: 0, writes: 0 };
  let budget = 0; // fractional steps carried between frames

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const loop = createLoop((dt) => {
    budget += dt * stepsPerSecond(speed);
    const whole = Math.floor(budget);
    budget -= whole;
    advance(whole);
    if (cursor >= steps.length) setPlaying(false);
  });

  // --- Model ---

  function newInput() {
    input = makeInput(inputKind, size, Math.random);
    retrace();
  }

  function retrace() {
    steps = getAlgorithm(algorithmId).sort(input).steps;
    scrub.input.max = String(steps.length);
    seek(0);
    setPlaying(false);
  }

  function advance(count: number) {
    const end = Math.min(steps.length, cursor + count);
    for (; cursor < end; cursor++) {
      applyStep(array, steps[cursor]);
      tally(counts, steps[cursor], 1);
    }
    update();
  }

  /** Jumps to any point in the trace by replaying from the start. */
  function seek(position: number) {
    cursor = Math.max(0, Math.min(steps.length, position));
    ({ array, counts } = replay(input, steps, cursor));
    update();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const n = array.length;
    if (n === 0) return;

    const pad = 12;
    const slot = (width - 2 * pad) / n;
    const gap = slot > 4 ? Math.min(2, slot * 0.15) : 0;
    const unit = (height - 2 * pad) / n;
    const done = cursor >= steps.length;
    const last = cursor > 0 && !done ? steps[cursor - 1] : undefined;

    for (let i = 0; i < n; i++) {
      let colour = done ? palette.accent : palette.muted;
      if (last && (i === last.i || (last.type !== 'write' && i === last.j))) {
        colour = last.type === 'compare' ? palette.compare : palette.change;
      }
      const barHeight = Math.max(1, array[i] * unit);
      ctx.fillStyle = colour;
      ctx.fillRect(pad + i * slot, height - pad - barHeight, Math.max(1, slot - gap), barHeight);
    }
  }

  function update() {
    draw();
    const done = cursor >= steps.length;
    comparisons.textContent = String(counts.comparisons);
    swaps.textContent = String(counts.swaps);
    writes.textContent = String(counts.writes);
    progress.textContent = `${cursor} / ${steps.length}`;
    scrub.set(cursor);
    status.textContent = done ? 'Sorted.' : describe(steps[cursor - 1]);
    stepButton.disabled = done;
    backButton.disabled = cursor === 0;
    playButton.disabled = done;
  }

  // --- Controls ---

  const comparisons = el('dd');
  const swaps = el('dd');
  const writes = el('dd');
  const progress = el('dd');
  // Announced only while stepping by hand; during playback it would be noise.
  const status = el('p', { class: 'note', 'aria-live': 'off' });
  const caption = el('p', { class: 'note' });

  let playing = false;
  const playButton = button('Play', () => setPlaying(!playing), 'primary');
  const stepButton = button('Step', () => {
    setPlaying(false);
    advance(1);
  });
  const backButton = button('Back', () => {
    setPlaying(false);
    seek(cursor - 1);
  });
  const resetButton = button('Reset', () => {
    setPlaying(false);
    seek(0);
  });

  function setPlaying(on: boolean) {
    playing = on && cursor < steps.length;
    playButton.textContent = playing ? 'Pause' : 'Play';
    status.setAttribute('aria-live', playing ? 'off' : 'polite');
    budget = 0;
    if (playing) loop.start();
    else loop.stop();
  }

  const scrub = slider({
    label: 'Position',
    min: 0,
    max: 1,
    value: 0,
    onInput(value) {
      setPlaying(false);
      seek(value);
    },
  });

  function describeAlgorithm() {
    const algorithm = getAlgorithm(algorithmId);
    caption.textContent = `${algorithm.summary} ${algorithm.complexity}.`;
  }

  const algorithmSelect = select<AlgorithmId>({
    label: 'Algorithm',
    options: ALGORITHMS,
    value: algorithmId,
    onChange(id) {
      algorithmId = id;
      retrace();
      describeAlgorithm();
      update();
    },
  });

  const inputSelect = select<InputKind>({
    label: 'Starting order',
    options: INPUT_KINDS,
    value: inputKind,
    onChange(kind) {
      inputKind = kind;
      regenerate();
    },
  });

  function regenerate() {
    newInput();
    describeAlgorithm();
    update();
  }

  const legend = el(
    'ul',
    { class: 'legend' },
    el('li', { style: '--swatch: var(--canvas-compare)', text: 'Compared' }),
    el('li', { style: '--swatch: var(--canvas-change)', text: 'Moved' }),
  );

  panel.append(
    fieldset(
      'Sort',
      algorithmSelect.root,
      caption,
      inputSelect.root,
      slider({
        label: 'Size',
        min: 4,
        max: 256,
        value: size,
        onInput(value) {
          size = value;
          regenerate();
        },
      }).root,
      button('New array', regenerate),
    ),
    fieldset(
      'Playback',
      slider({
        label: 'Speed',
        min: 0,
        max: 100,
        value: speed,
        format: (v) => `${stepsPerSecond(v)} steps/s`,
        onInput: (value) => (speed = value),
      }).root,
      el('div', { class: 'buttons' }, playButton, stepButton, backButton, resetButton),
      scrub.root,
    ),
    fieldset(
      'Counts',
      el(
        'dl',
        { class: 'stats' },
        el('dt', { text: 'Comparisons' }),
        comparisons,
        el('dt', { text: 'Swaps' }),
        swaps,
        el('dt', { text: 'Writes' }),
        writes,
        el('dt', { text: 'Step' }),
        progress,
      ),
      status,
      legend,
    ),
  );

  about.append(
    prose(
      'Each algorithm runs once up front and records every comparison, swap and write. Playback moves a cursor through that list, so you can pause, step either way, or drag the position slider.',
    ),
    prose(
      'Comparisons and moves are counted separately because they cost differently. Selection sort compares a lot but swaps at most `n − 1` times; merge sort never swaps, it copies values back from a buffer, counted as writes.',
    ),
    prose(
      'Try the same starting order on different algorithms. Nearly sorted input is where insertion sort beats the `n log n` sorts.',
    ),
  );

  newInput();
  describeAlgorithm();
  update();

  return () => {
    loop.stop();
    stage.dispose();
    theme.dispose();
  };
}

export const sorting: Demo = {
  id: 'sorting',
  title: 'Sorting',
  summary: 'Six sorting algorithms, one step at a time, with every comparison and move counted.',
  mount,
};
