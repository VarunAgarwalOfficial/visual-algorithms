import { ALGORITHMS, type Algorithm } from '../../core/sorting/algorithms';
import { Playback } from '../../core/sorting/trace';
import { createStage } from '../../ui/canvas';
import { checkbox, el, fieldset, select } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, legend, prose, stats, type Mount } from '../layout';
import { INPUT_DEFAULTS, inputControls } from './input';
import { drawSort, FONT, SMALL_FONT, VIEW_MODES, type ViewMode } from './render';

const MIN_RACERS = 2;
const MAX_RACERS = 6;
const DEFAULT_RACERS = 'quick.merge.heap.shell';

interface Racer {
  algorithm: Algorithm;
  playback: Playback;
  /** 1 for the shortest trace; racers with equal traces share a place. */
  place: number;
}

/** The algorithms named in a dot-separated list, without repeats, within the allowed number. */
function parseRacers(text: string): Algorithm[] {
  const ids = new Set(text.split('.'));
  const chosen = ALGORITHMS.filter((a) => ids.has(a.id)).slice(0, MAX_RACERS);
  return chosen.length >= MIN_RACERS ? chosen : parseRacers(DEFAULT_RACERS);
}

const ordinal = (place: number) => `${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}`;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Several sorting algorithms side by side, each sorting a copy of the same array.',
  );

  const url = urlState({ algs: DEFAULT_RACERS, view: 'bars', ...INPUT_DEFAULTS, speed: 120 });
  const settings = url.state;
  settings.speed = Math.max(0.5, Math.min(2000, settings.speed));
  const view = (): ViewMode => VIEW_MODES.find((m) => m.id === settings.view)?.id ?? 'bars';

  let racers: Racer[] = [];
  let scaleMax = 1;

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
      // Every racer has done the same number of operations, or has finished.
      for (const racer of racers) racer.playback.seek(position);
      update();
    },
  });

  // --- Model ---

  function restart() {
    const values = input.values();
    const chosen = parseRacers(settings.algs);
    settings.algs = chosen.map((a) => a.id).join('.');
    settings.view = view();
    scaleMax = Math.max(values.length, ...values);
    racers = chosen.map((algorithm) => ({
      algorithm,
      playback: new Playback(values, algorithm.sort(values)),
      place: 0,
    }));
    for (const racer of racers) {
      racer.place = 1 + racers.filter((r) => r.playback.length < racer.playback.length).length;
    }
    player.setLength(Math.max(...racers.map((r) => r.playback.length)));
    url.save();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const count = racers.length;
    if (count === 0) return;

    const columns = count <= 2 ? count : count === 4 || (count === 3 && width < 420) ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const gap = Math.min(14, width * 0.03);
    const pad = Math.min(10, width * 0.025);
    const cellW = (width - 2 * pad - (columns - 1) * gap) / columns;
    const cellH = (height - 2 * pad - (rows - 1) * gap) / rows;
    // Two lines of text above the bars: the name, then the counts.
    const header = 46;

    racers.forEach((racer, k) => {
      const x = pad + (k % columns) * (cellW + gap);
      const y = pad + Math.floor(k / columns) * (cellH + gap);
      const { playback, algorithm } = racer;

      ctx.textBaseline = 'alphabetic';
      ctx.font = FONT;
      let placeWidth = 0;
      if (playback.done) {
        const text = ordinal(racer.place);
        placeWidth = ctx.measureText(text).width + 6;
        ctx.textAlign = 'right';
        ctx.fillStyle = palette.good;
        ctx.fillText(text, x + cellW, y + 15);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = palette.ink;
      ctx.fillText(algorithm.name.replace(/ \(.*\)$/, ''), x, y + 15, cellW - placeWidth);

      const { comparisons, swaps, writes, reads } = playback.counts;
      const split =
        reads > 0
          ? `${reads} reads · ${writes} writes`
          : `${comparisons} compares · ${swaps + writes} moves`;
      ctx.font = SMALL_FONT;
      ctx.fillStyle = palette.ink;
      ctx.globalAlpha = 0.75;
      const line = ctx.measureText(split).width <= cellW ? split : `${playback.position} ops`;
      ctx.fillText(line, x, y + 36, cellW);
      ctx.globalAlpha = 1;

      const rect = { x, y: y + header, w: cellW, h: cellH - header };
      drawSort(ctx, palette, rect, playback, view(), scaleMax);
      ctx.fillStyle = palette.faint;
      ctx.fillRect(x, y + cellH + 2, cellW, 1);
    });
  }

  function update() {
    draw();
    const finished = racers
      .filter((r) => r.playback.done)
      .sort((a, b) => a.playback.length - b.playback.length);
    counters.set({
      operations: player.position,
      finished: `${finished.length} of ${racers.length}`,
    });
    const names = finished.map(
      (r) => `${ordinal(r.place)} ${r.algorithm.name} (${r.playback.length})`,
    );
    status.textContent =
      finished.length === 0
        ? 'No one has finished yet. Every racer does one operation per step.'
        : `Finished, with operations used: ${names.join(', ')}.`;
  }

  // --- Controls ---

  const counters = stats({ operations: 'Operations each', finished: 'Finished' });
  const status = el('p', { class: 'note' });
  const limit = el('p', {
    class: 'note',
    text: `Pick ${MIN_RACERS} to ${MAX_RACERS} algorithms.`,
  });
  const input = inputControls(settings, () => restart());

  const chosenIds = new Set(parseRacers(settings.algs).map((a) => a.id));
  const boxes = ALGORITHMS.map((algorithm) => {
    const label = checkbox({
      label: algorithm.name,
      checked: chosenIds.has(algorithm.id),
      onChange(on) {
        const box = label.querySelector('input');
        if (on) chosenIds.add(algorithm.id);
        else chosenIds.delete(algorithm.id);
        if (chosenIds.size < MIN_RACERS || chosenIds.size > MAX_RACERS) {
          // Refuse the change and say why.
          if (on) chosenIds.delete(algorithm.id);
          else chosenIds.add(algorithm.id);
          if (box) box.checked = !on;
          limit.classList.add('error');
          return;
        }
        limit.classList.remove('error');
        settings.algs = [...chosenIds].join('.');
        restart();
      },
    });
    return label;
  });

  panel.append(
    fieldset('Racers', ...boxes, limit),
    fieldset(
      'View',
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
      ['var(--canvas-good)', 'Sorted'],
      ['var(--canvas-accent)', 'Bucket tallies'],
    ]),
  );

  about.append(
    prose(
      'Every panel sorts a copy of the same array. Each step of the player gives every algorithm one operation: a comparison, a swap, a write or a bucket read. The first to finish is the one that needs the fewest operations, not the one with the fastest code.',
    ),
    prose(
      'That is a fair race on paper and a rough one in practice. A swap is two or three writes, a comparison may be a slow call, and merge, counting and radix sort also use extra memory that this count ignores. Real libraries pick by more than operation counts.',
    ),
    prose(
      'Change the starting order to see the rankings move. Insertion sort and timsort win on nearly sorted input. Quicksort does well on random input. Counting and radix sort never compare, so they finish in a number of steps that depends only on `n` and on the size of the values.',
    ),
  );

  restart();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
