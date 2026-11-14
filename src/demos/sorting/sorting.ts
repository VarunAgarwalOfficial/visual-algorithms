import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../../core/sorting/algorithms';
import { Playback, type Step } from '../../core/sorting/trace';
import { createStage } from '../../ui/canvas';
import { checkbox, el, fieldset, select } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { createTone } from './audio';
import { INPUT_DEFAULTS, inputControls } from './input';
import {
  columns,
  drawSort,
  FONT,
  splitRect,
  usesBuckets,
  VIEW_MODES,
  type Rect,
  type ViewMode,
} from './render';

/** Says what a step did, given the array after it. */
function describe(step: Step, playback: Playback): string {
  const { array, buckets, bucketBase } = playback;
  const at = (i: number) => `position ${i + 1}`;
  switch (step.type) {
    case 'compare':
      return `Compare ${array[step.i]} at ${at(step.i)} with ${array[step.j]} at ${at(step.j)}.`;
    case 'swap':
      return `Swap ${array[step.j]} and ${array[step.i]}, at positions ${step.i + 1} and ${step.j + 1}.`;
    case 'write':
      return step.bucket === undefined
        ? `Write ${step.value} to ${at(step.i)}.`
        : `Write ${step.value} to ${at(step.i)}, from bucket ${step.bucket + bucketBase}.`;
    case 'read':
      return `Read ${array[step.i]} at ${at(step.i)}: bucket ${step.bucket + bucketBase} now holds ${buckets[step.bucket]}.`;
  }
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'The array being sorted, drawn as bars, dots or a colour wheel. The values in use are highlighted.',
  );

  const url = urlState({ alg: 'quick', view: 'bars', ...INPUT_DEFAULTS, speed: 60 });
  const settings = url.state;
  settings.speed = Math.max(0.5, Math.min(2000, settings.speed));
  const algorithm = () => getAlgorithm(settings.alg);
  const view = (): ViewMode => VIEW_MODES.find((m) => m.id === settings.view)?.id ?? 'bars';

  let playback = new Playback([], algorithm().sort([]));
  let scaleMax = 1;
  let sound = false;
  const tone = createTone();

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
      const before = playback.position;
      playback.seek(position);
      update();
      const last = playback.last;
      if (sound && last && playback.position !== before) {
        tone.note(playback.array[last.i] / scaleMax);
      }
    },
  });

  // --- Model ---

  function retrace() {
    const values = input.values();
    const chosen = algorithm();
    settings.alg = chosen.id;
    settings.view = view();
    playback = new Playback(values, chosen.sort(values));
    scaleMax = Math.max(values.length, ...values);
    caption.textContent = `${chosen.summary} ${chosen.complexity}. ${
      chosen.stable ? 'Stable' : 'Not stable'
    }.`;
    player.setLength(playback.length);
    url.save();
  }

  // --- Rendering ---

  /** The part of the canvas under the label line. */
  function body(): Rect {
    const pad = Math.min(12, stage.width * 0.03);
    return { x: pad, y: pad + 18, w: stage.width - 2 * pad, h: stage.height - 2 * pad - 18 };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const rect = body();
    drawSort(ctx, palette, rect, playback, view(), scaleMax);

    const label = playback.done
      ? 'Sorted'
      : (playback.mark?.label ??
        (editable() ? 'Drag the bars to change the values' : algorithm().name));
    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.ink;
    ctx.fillText(label, rect.x, rect.y - 7, rect.w);
  }

  function update() {
    draw();
    counters.set({ ...playback.counts });
    const last = playback.last;
    status.textContent = playback.done
      ? `Sorted after ${playback.length} steps.`
      : last
        ? describe(last, playback)
        : 'Ready. Press Play, or step through one operation at a time.';
  }

  // --- Editing the input by dragging bars ---

  const editable = () => view() === 'bars' && player.position === 0 && !player.playing;
  let dragged: number[] = [];
  let lastIndex = 0;

  function dragTo(x: number, y: number) {
    const { plot } = splitRect(body(), usesBuckets(playback));
    const { indexAt, valueAt } = columns(plot, dragged.length, scaleMax);
    const index = indexAt(x);
    const value = valueAt(y);
    // Fill every bar passed over since the last event, so a fast drag leaves no gaps.
    for (let i = Math.min(index, lastIndex); i <= Math.max(index, lastIndex); i++) {
      dragged[i] = value;
    }
    lastIndex = index;
    const scale = scaleMax;
    input.setCustom(dragged);
    // Hold the scale still while dragging, so the bar stays under the pointer.
    scaleMax = scale;
    draw();
  }

  const stopDrag = onDrag(canvas, {
    down(point) {
      if (!editable()) return false;
      dragged = [...input.values()];
      const { plot } = splitRect(body(), usesBuckets(playback));
      lastIndex = columns(plot, dragged.length, scaleMax).indexAt(point.x);
      dragTo(point.x, point.y);
      return true;
    },
    move: (point) => dragTo(point.x, point.y),
    up() {
      scaleMax = Math.max(dragged.length, ...dragged);
      draw();
    },
  });

  // --- Controls ---

  const counters = stats({
    comparisons: 'Comparisons',
    swaps: 'Swaps',
    writes: 'Writes',
    reads: 'Bucket reads',
  });
  const status = el('p', { class: 'note' });
  const caption = el('p', { class: 'note' });
  const input = inputControls(settings, () => retrace());

  panel.append(
    fieldset(
      'Sort',
      select<AlgorithmId>({
        label: 'Algorithm',
        options: ALGORITHMS,
        value: algorithm().id,
        onChange(id) {
          settings.alg = id;
          retrace();
        },
      }).root,
      caption,
      select<ViewMode>({
        label: 'Drawn as',
        options: VIEW_MODES,
        value: view(),
        onChange(mode) {
          settings.view = mode;
          url.save();
          draw();
        },
      }).root,
      checkbox({
        label: 'Sound: pitch follows the value in use',
        checked: false,
        onChange(on) {
          sound = on;
          if (!on) tone.stop();
        },
      }),
    ),
    fieldset('Input', ...input.nodes),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-compare)', 'Compared or read'],
      ['var(--canvas-change)', 'Swapped or written'],
      [
        'color-mix(in srgb, var(--canvas-series-1) 60%, var(--canvas-bg))',
        'Range or run in work (one colour each)',
      ],
      ['var(--canvas-accent)', 'Sorted, and bucket tallies'],
    ]),
  );

  about.append(
    prose(
      'Each algorithm runs once up front and records every comparison, swap, write and bucket read. Playback moves a cursor through that list, so you can pause, step either way, or drag the step slider. At step 0, in the bars view, you can drag bar heights to make your own input, or type a list of values.',
    ),
    prose(
      'A sort that only learns about values by comparing them cannot beat `n log n` in the worst case. There are `n!` possible orderings and each comparison has two outcomes, so `h` comparisons can tell apart at most `2^h` orderings.',
    ),
    formula('2^h ≥ n!   so   h ≥ log₂(n!) = n log₂ n − 1.44 n + O(log n)'),
    prose(
      'Counting sort and radix sort get under that bound by not comparing at all. They use a value, or one digit of it, as an index into a row of buckets. Counting sort takes `n + k` steps for `k` possible values; radix sort takes `d (n + b)` for `d` digits in base `b`. That is linear when the values are short, and no help when they are long or are not numbers.',
    ),
    prose(
      'A sort is stable if equal values keep their original order. Radix sort depends on it: the pass on the tens digit must not undo the order the ones digit made. Insertion, merge, counting and timsort are stable; quicksort, heapsort, selection and shell sort move values over long distances and are not.',
    ),
    prose(
      'Merge steps here are shown in two phases so the picture stays honest: first every comparison of the merge, made while both halves are still in the array, then the sweep that writes the merged values back. The counts are the same as for an ordinary merge. Try nearly sorted input on insertion sort, and sorted runs on timsort.',
    ),
  );

  retrace();

  return () => {
    player.dispose();
    stopDrag();
    stage.dispose();
    theme.dispose();
    tone.dispose();
  };
};
