import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../../core/sorting/algorithms';
import { INPUT_KINDS, makeInput, type InputKind } from '../../core/sorting/inputs';
import { newSeed, seeded } from '../../core/random';
import { applyStep, replay, tally, type Counts, type Step } from '../../core/sorting/trace';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, legend, prose, stats, type Mount } from '../layout';

function describe(step: Step | undefined): string {
  if (!step) return 'Ready.';
  if (step.type === 'compare') return `Compare positions ${step.i + 1} and ${step.j + 1}.`;
  if (step.type === 'swap') return `Swap positions ${step.i + 1} and ${step.j + 1}.`;
  return `Write ${step.value} to position ${step.i + 1}.`;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Bar chart of the array being sorted. The bars in use are highlighted.',
  );

  const url = urlState({ alg: 'quick', input: 'random', n: 48, seed: 1, speed: 60 });
  const settings = url.state;
  settings.n = Math.max(4, Math.min(256, Math.round(settings.n)));
  const algorithmId = () => getAlgorithm(settings.alg).id;
  const inputKind = (): InputKind =>
    INPUT_KINDS.find((k) => k.id === settings.input)?.id ?? 'random';

  let input: number[] = [];
  let steps: Step[] = [];
  let array: number[] = [];
  let cursor = 0; // number of steps applied to `array`
  let counts: Counts = { comparisons: 0, swaps: 0, writes: 0 };

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 2000,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(position) {
      if (position >= cursor) {
        // Forwards: apply only the new steps.
        for (; cursor < position; cursor++) {
          applyStep(array, steps[cursor]);
          tally(counts, steps[cursor], 1);
        }
      } else {
        // Backwards: replay from the start.
        ({ array, counts } = replay(input, steps, position));
        cursor = position;
      }
      update();
    },
  });

  // --- Model ---

  function newInput() {
    input = makeInput(inputKind(), settings.n, seeded(settings.seed));
    retrace();
  }

  function retrace() {
    steps = getAlgorithm(settings.alg).sort(input).steps;
    array = [...input];
    cursor = 0;
    counts = { comparisons: 0, swaps: 0, writes: 0 };
    const algorithm = getAlgorithm(settings.alg);
    caption.textContent = `${algorithm.summary} ${algorithm.complexity}.`;
    player.setLength(steps.length);
    url.save();
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
    counters.set({ comparisons: counts.comparisons, swaps: counts.swaps, writes: counts.writes });
    status.textContent = cursor >= steps.length ? 'Sorted.' : describe(steps[cursor - 1]);
  }

  // --- Controls ---

  const counters = stats({ comparisons: 'Comparisons', swaps: 'Swaps', writes: 'Writes' });
  const status = el('p', { class: 'note' });
  const caption = el('p', { class: 'note' });

  panel.append(
    fieldset(
      'Sort',
      select<AlgorithmId>({
        label: 'Algorithm',
        options: ALGORITHMS,
        value: algorithmId(),
        onChange(id) {
          settings.alg = id;
          retrace();
        },
      }).root,
      caption,
      select<InputKind>({
        label: 'Starting order',
        options: INPUT_KINDS,
        value: inputKind(),
        onChange(kind) {
          settings.input = kind;
          newInput();
        },
      }).root,
      slider({
        label: 'Size',
        min: 4,
        max: 256,
        value: settings.n,
        onInput(value) {
          settings.n = value;
          newInput();
        },
      }).root,
      button('New array', () => {
        settings.seed = newSeed();
        newInput();
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-compare)', 'Compared'],
      ['var(--canvas-change)', 'Moved'],
    ]),
  );

  about.append(
    prose(
      'Each algorithm runs once up front and records every comparison, swap and write. Playback moves a cursor through that list, so you can pause, step either way, or drag the step slider.',
    ),
    prose(
      'Comparisons and moves are counted separately because they cost differently. Selection sort compares a lot but swaps at most `n − 1` times; merge sort never swaps, it copies values back from a buffer, counted as writes.',
    ),
    prose(
      'Try the same starting order on different algorithms. Nearly sorted input is where insertion sort beats the `n log n` sorts.',
    ),
  );

  newInput();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
