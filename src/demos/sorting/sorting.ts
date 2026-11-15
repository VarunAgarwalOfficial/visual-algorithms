import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../../core/sorting/algorithms';
import { Playback, type Step } from '../../core/sorting/trace';
import { createStage } from '../../ui/canvas';
import { checkbox, el, fieldset, select } from '../../ui/dom';
import { SMALL, wrapLines } from '../../ui/font';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { createTone } from './audio';
import { INPUT_KINDS } from '../../core/sorting/inputs';
import { INPUT_DEFAULTS, inputControls } from './input';
import {
  columns,
  drawSort,
  FONT,
  layoutSort,
  usesBuckets,
  VIEW_MODES,
  type Rect,
  type ViewMode,
} from './render';

/** Height of one line of the label over the bars. */
const LINE = SMALL + 6;

/** Says what a step did, given the array after it, in the words drawn over the bars. */
function describe(step: Step, playback: Playback): string {
  const { array, buckets, bucketBase } = playback;
  const at = (i: number) => `position ${i + 1}`;
  switch (step.type) {
    case 'compare':
      return `Compare ${array[step.i]} with ${array[step.j]} (the bars marked "compare") to see which should come first.`;
    case 'swap':
      return `Swap: ${array[step.j]} and ${array[step.i]} were in the wrong order, so they change places (positions ${step.i + 1} and ${step.j + 1}).`;
    case 'write':
      return step.bucket === undefined
        ? `Write ${step.value} into ${at(step.i)}.`
        : `Write ${step.value} into ${at(step.i)}, taking it from bucket ${step.bucket + bucketBase}.`;
    case 'read':
      return `Read ${array[step.i]} at ${at(step.i)} and count it in bucket ${step.bucket + bucketBase}, which now holds ${buckets[step.bucket]}.`;
  }
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'The array being sorted, drawn as bars, dots or a colour wheel. The values in use are highlighted.',
  );

  const url = urlState({ alg: 'quick', view: 'bars', ...INPUT_DEFAULTS, n: 20, speed: 8 });
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
    showUsed();
    url.save();
  }

  /** Shows only the counters and key entries this algorithm's run can use. */
  function showUsed() {
    const used = new Set(playback.trace.steps.map((step) => step.type));
    const buckets = usesBuckets(playback);
    const ranged = playback.trace.marks.some((mark) => mark.ranges?.length);
    counters.show('comparisons', used.has('compare'));
    counters.show('swaps', used.has('swap'));
    counters.show('writes', used.has('write'));
    counters.show('reads', used.has('read'));
    const items: [string, string][] = [];
    if (used.has('compare') || used.has('read')) {
      items.push([
        'var(--canvas-compare)',
        used.has('read') ? 'Being compared or read' : 'Being compared',
      ]);
    }
    if (used.has('swap') || used.has('write')) {
      items.push([
        'var(--canvas-change)',
        used.has('write') ? 'Just moved or written' : 'Just swapped',
      ]);
    }
    if (ranged) {
      items.push(['var(--canvas-muted)', 'Part of the array being worked on']);
    }
    if (buckets) items.push(['var(--canvas-accent)', 'Bucket counts']);
    items.push(['var(--canvas-good)', 'Sorted (at the end)']);
    key.replaceChildren(...legend(items).children);
  }

  // --- Rendering ---

  /** The words over the picture: what the current step is doing. */
  function label(): string {
    return playback.done
      ? 'Sorted: shortest on the left, tallest on the right'
      : (playback.mark?.label ??
          (player.position === 0
            ? `Nothing has run yet${editable() ? ' (you can drag a bar to change its value)' : ''}`
            : algorithm().name));
  }

  /** The label, wrapped to the canvas width (it is never squeezed or cut). */
  function labelLines(): string[] {
    const pad = Math.min(12, stage.width * 0.03);
    stage.ctx.font = FONT;
    return wrapLines(stage.ctx, label(), stage.width - 2 * pad);
  }

  /** The part of the canvas under the label lines. */
  function body(lines = labelLines().length): Rect {
    const pad = Math.min(12, stage.width * 0.03);
    const top = lines * LINE;
    return { x: pad, y: pad + top, w: stage.width - 2 * pad, h: stage.height - 2 * pad - top };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const lines = labelLines();
    const rect = body(lines.length);
    drawSort(ctx, palette, rect, playback, view(), scaleMax);

    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.ink;
    lines.forEach((line, k) =>
      ctx.fillText(line, rect.x, rect.y - 7 - (lines.length - 1 - k) * LINE),
    );
  }

  function update() {
    draw();
    counters.set({ ...playback.counts });
    const last = playback.last;
    status.textContent = playback.done
      ? `Sorted after ${playback.length} steps: every bar is now no taller than the one to its right.`
      : last
        ? describe(last, playback)
        : `Nothing has run yet. These ${playback.array.length} bars are in ${orderName()} order, and each bar is as tall as the number under it. Press Play to watch ${algorithm().name.toLowerCase()} put them in order from shortest to tallest, or Step forward to see one step at a time.`;
  }

  // --- Editing the input by dragging bars ---

  const editable = () => view() === 'bars' && player.position === 0 && !player.playing;
  let dragged: number[] = [];
  let lastIndex = 0;

  function dragTo(x: number, y: number) {
    const { plot } = layoutSort(body(), playback, view());
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
      const { plot } = layoutSort(body(), playback, view());
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
  const key = el('ul', { class: 'legend' });
  const orderName = () =>
    settings.input === 'custom'
      ? 'your'
      : (INPUT_KINDS.find((k) => k.id === settings.input)?.name.toLowerCase() ?? 'random');
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

  readout.append(counters.root, status, key);

  about.append(
    prose(
      'Each algorithm runs once up front and records every comparison, swap, write and bucket read. Playback moves a cursor through that list, so you can pause, step either way, or drag the "Steps done" slider. Before the first step, in the bars view, you can drag bar heights to make your own input, or type a list of values.',
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
