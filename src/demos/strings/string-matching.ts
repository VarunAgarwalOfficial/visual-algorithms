import {
  matchTrace,
  naiveComparisons,
  type Matcher,
  type MatchStep,
  type MatchTrace,
} from '../../core/strings/matching';
import { newSeed, randomInt, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { mix, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clean, FONT, glyph, MONO } from './table';
import { drawHint } from '../../ui/font';

const MAX_TEXT = 28;
const MAX_PATTERN = 8;
const MATCHERS: readonly { id: Matcher; name: string }[] = [
  { id: 'kmp', name: 'Knuth–Morris–Pratt' },
  { id: 'z', name: 'Z algorithm' },
  { id: 'naive', name: 'Naive (baseline)' },
];
const PRESETS = [
  { id: 'overlap', name: 'Overlapping matches', text: 'abababcabababab', pattern: 'ababab' },
  { id: 'worst', name: 'Worst case for naive', text: 'aaaaaaaaaaaaaaaaaaab', pattern: 'aaaab' },
  { id: 'dna', name: 'DNA', text: 'GATTACAGATTAGATTACA', pattern: 'GATTACA' },
  { id: 'words', name: 'Words', text: 'she sells sea shells', pattern: 'she' },
] as const;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A text with the pattern sliding beneath it. Compared letters are coloured by match or mismatch, and the failure table or Z array is shown under the letters.',
  );

  const url = urlState({ alg: 'kmp', text: 'abababcabababab', pat: 'ababab', speed: 4 });
  const settings = url.state;
  settings.text = clean(settings.text, MAX_TEXT);
  settings.pat = clean(settings.pat, MAX_PATTERN);
  const matcher = (): Matcher => MATCHERS.find((m) => m.id === settings.alg)?.id ?? 'kmp';

  let trace: MatchTrace = matchTrace('naive', '', '');
  let naiveTotal = 0;
  // Running totals after each step: [build comparisons, search comparisons, matches].
  let totals: [number, number, number][] = [[0, 0, 0]];
  let position = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const counters = stats({
    build: 'Table comparisons',
    search: 'Search comparisons',
    naive: 'Naive search total',
    matches: 'Matches',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const answer = el('p', { class: 'note', style: 'flex-basis: 100%' });

  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 100,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      update();
    },
  });

  function rebuild() {
    trace = matchTrace(matcher(), settings.text, settings.pat);
    naiveTotal = naiveComparisons(settings.text, settings.pat);
    totals = [[0, 0, 0]];
    for (const step of trace.steps) {
      const [b, s, f] = totals[totals.length - 1];
      const compare = step.kind === 'compare';
      totals.push([
        b + (compare && step.phase === 'build' ? 1 : 0),
        s + (compare && step.phase === 'search' ? 1 : 0),
        f + (step.kind === 'found' ? 1 : 0),
      ]);
    }
    url.save();
    player.setLength(trace.steps.length);
  }

  const tableName = () => (matcher() === 'z' ? 'Z' : 'fail');

  function update() {
    draw();
    const [build, search, found] = totals[position];
    counters.set({
      build: matcher() === 'naive' ? '–' : build,
      search,
      naive: naiveTotal,
      matches: found,
    });
    const step = trace.steps[position - 1];
    const done = position >= trace.steps.length;
    if (settings.pat.length === 0) status.textContent = 'Type a pattern to search for.';
    else if (!step) {
      status.textContent =
        trace.steps.length === 0
          ? 'The pattern is longer than the text, so there is nothing to compare.'
          : matcher() === 'naive'
            ? 'Nothing has run yet. The naive matcher tries every position and compares from the start of the pattern each time.'
            : `Nothing has run yet. Press Play: phase 1 builds the ${tableName()} table from the pattern alone; phase 2 scans the text.`;
    } else status.textContent = step.text;

    if (done && settings.pat.length > 0) {
      const where = trace.matches.length
        ? `${trace.matches.length === 1 ? 'Match' : 'Matches'} at ${trace.matches.join(', ')}`
        : 'No match';
      const cost =
        matcher() === 'naive'
          ? `${search} comparisons`
          : `${build} comparisons for the table + ${search} in the text = ${build + search}; the naive scan needs ${naiveTotal}`;
      answer.textContent = `${where}. ${cost}.`;
    } else answer.textContent = '';
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { text, pat } = settings;
    ctx.clearRect(0, 0, width, height);
    if (text.length === 0 && pat.length === 0) {
      drawHint(ctx, width, height, palette.muted, 'Type a text and a pattern to search for.');
    }
    const step: MatchStep | undefined = trace.steps[position - 1];
    const building = step ? step.phase === 'build' : trace.steps[0]?.phase === 'build';
    const top = building ? pat : text;
    const m = pat.length;
    const z = matcher() === 'z';
    const shift = step?.shift ?? 0;

    const pad = Math.max(6, width * 0.02);
    const labelW = Math.max(26, Math.min(48, width * 0.08));
    // A little room past the end of the top string for an overhanging pattern.
    const columns = Math.max(top.length, m, 1) + (building ? Math.max(1, m) : 2);
    const cell = Math.min(46, (width - 2 * pad - labelW) / columns);
    const cellH = Math.min(46, Math.max(cell, height * 0.085));
    const x0 = pad + labelW + (width - 2 * pad - labelW - cell * columns) / 2;
    const letter = Math.max(8, Math.min(22, cell * 1.15, cellH * 0.6));
    const small = Math.max(7, Math.min(12, cell * 0.92, cellH * 0.42));
    const rowGap = cellH * 0.75;

    const blockH = cellH * 2 + small * 5.6 + rowGap + small * 2;
    const titleH = Math.max(14, small * 1.8);
    const y0 = Math.max(pad + titleH + small * 2.2, (height - blockH) / 2 + small * 2);
    const yTop = y0;
    const yTopVals = yTop + cellH + small * 0.9;
    const yBottom = yTop + cellH + small * 1.8 + rowGap;
    const yBottomVals = yBottom + cellH + small * 0.9;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${Math.max(9, Math.min(13, width * 0.03))}px ${FONT}`;
    ctx.fillStyle = palette.muted;
    const title =
      m === 0
        ? ''
        : building
          ? `Phase 1: the pattern against itself, building ${z ? 'Z' : 'fail'}`
          : matcher() === 'naive'
            ? 'Searching the text'
            : 'Phase 2: searching the text';
    ctx.fillText(title, pad, pad + titleH / 2);

    const box = (
      x: number,
      y: number,
      ch: string,
      fill: string | undefined,
      stroke: string,
      ink: string,
    ) => {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, cell, cellH);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cellH - 1);
      ctx.fillStyle = ink;
      ctx.font = `${letter}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(glyph(ch), x + cell / 2, y + cellH / 2 + 0.5);
    };
    const tint = (colour: string, amount = 0.34) => mix(palette.bg, colour, amount);

    // What each column of the two rows shows.
    const matchedFrom = shift;
    const matchedTo = shift + (step?.matched ?? 0);
    const compareAt = step?.kind === 'compare' ? step.at : undefined;
    const found = step?.kind === 'found';
    const fillFor = (topIndex: number): string | undefined => {
      if (!step) return undefined;
      if (topIndex === compareAt) return tint(step.equal ? palette.good : palette.change, 0.5);
      if (topIndex >= matchedFrom && topIndex < matchedTo)
        return tint(palette.good, found ? 0.55 : 0.28);
      return undefined;
    };

    // Row labels.
    ctx.textAlign = 'left';
    ctx.font = `${small}px ${FONT}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText(building ? 'P' : 'T', pad, yTop + cellH / 2);
    ctx.fillText('P', pad, yBottom + cellH / 2);
    if (matcher() !== 'naive') {
      ctx.fillText(tableName(), pad, yBottomVals);
      if (building || z) ctx.fillText(building ? tableName() : 'Zt', pad, yTopVals);
    }

    // Top row with its index numbers.
    for (let i = 0; i < top.length; i++) {
      const x = x0 + i * cell;
      box(x, yTop, top[i], fillFor(i), palette.faint, palette.ink);
      if (cell >= 13 || i % 5 === 0) {
        ctx.font = `${small * 0.9}px ${FONT}`;
        ctx.fillStyle = i === compareAt ? palette.ink : palette.muted;
        ctx.fillText(String(i), x + cell / 2, yTop - small * 0.9);
      }
    }
    if (compareAt !== undefined) {
      ctx.strokeStyle = palette.compare;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + compareAt * cell + 1, yTop + 1, cell - 2, cellH - 2);
      ctx.strokeRect(x0 + compareAt * cell + 1, yBottom + 1, cell - 2, cellH - 2);
      // A tick between the two letters being compared.
      ctx.beginPath();
      ctx.moveTo(x0 + (compareAt + 0.5) * cell, yTop + cellH + small * 1.7);
      ctx.lineTo(x0 + (compareAt + 0.5) * cell, yBottom - 2);
      ctx.stroke();
    }

    // Matches already reported: a bar under the text.
    if (!building) {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2.5;
      const count = totals[position][2];
      for (let k = 0; k < count; k++) {
        const s = trace.matches[k];
        ctx.beginPath();
        ctx.moveTo(x0 + s * cell + 2, yTop + cellH + 1.5 + (k % 2) * 3);
        ctx.lineTo(x0 + (s + m) * cell - 2, yTop + cellH + 1.5 + (k % 2) * 3);
        ctx.stroke();
      }
    }

    // The pattern, moved along by `shift`.
    for (let j = 0; j < m; j++) {
      const column = shift + j;
      if (column >= columns) break;
      const beyond = column >= top.length;
      box(
        x0 + column * cell,
        yBottom,
        pat[j],
        beyond ? undefined : fillFor(column),
        beyond ? palette.faint : palette.muted,
        beyond ? palette.muted : palette.ink,
      );
    }

    // Tables: the top row's own values, and the pattern's table under the pattern.
    const values = (
      table: readonly number[],
      known: number,
      y: number,
      offset: number,
      active: number | undefined,
      colour: string,
    ) => {
      ctx.textAlign = 'center';
      for (let k = 0; k < Math.min(known, table.length); k++) {
        const column = offset + k;
        if (column >= columns) break;
        const x = x0 + column * cell;
        if (k === active) {
          ctx.fillStyle = tint(colour, 0.45);
          ctx.fillRect(x + 1, y - small * 0.8, cell - 2, small * 1.6);
        }
        ctx.font = `${k === active ? '600 ' : ''}${small}px ${FONT}`;
        ctx.fillStyle = k === active ? palette.ink : palette.muted;
        ctx.fillText(String(table[k]), x + cell / 2, y + 0.5);
      }
    };
    if (matcher() !== 'naive' && m > 0) {
      const writes = step && (step.kind === 'set' || step.kind === 'found') ? step.cell : undefined;
      const reads = step?.kind === 'shift' ? step.cell : undefined;
      const known = step?.known ?? 0;
      if (building) values(trace.table, known, yTopVals, 0, writes, palette.change);
      else if (z)
        values(trace.textTable, step?.knownText ?? 0, yTopVals, 0, writes, palette.change);
      values(trace.table, building ? known : m, yBottomVals, shift, reads, palette.compare);
    }

    // The Z-box: the stretch of the top row known to equal a prefix of the pattern.
    if (step?.box) {
      const [l, r] = step.box;
      const y = yTop - small * 2;
      ctx.strokeStyle = palette.series[4];
      ctx.fillStyle = palette.series[4];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + l * cell + 1, y + 4);
      ctx.lineTo(x0 + l * cell + 1, y);
      ctx.lineTo(x0 + r * cell - 1, y);
      ctx.lineTo(x0 + r * cell - 1, y + 4);
      ctx.stroke();
      ctx.font = `${small}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`box [${l}, ${r})`, x0 + l * cell, y - small * 0.8);
      if (step.kind === 'shift') {
        // The pattern sits under the box: the same letters, so the same Z values apply.
        const by = yBottom - 4;
        ctx.beginPath();
        ctx.moveTo(x0 + l * cell + 1, by + 3);
        ctx.lineTo(x0 + l * cell + 1, by);
        ctx.lineTo(x0 + r * cell - 1, by);
        ctx.lineTo(x0 + r * cell - 1, by + 3);
        ctx.stroke();
        if (step.at !== undefined) {
          ctx.strokeStyle = palette.compare;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x0 + (step.at + 0.5) * cell, yTop + cellH + 2);
          ctx.lineTo(x0 + (step.at + 0.5) * cell, yBottom - 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  // --- Controls ---

  const presetOf = () =>
    PRESETS.find((p) => p.text === settings.text && p.pattern === settings.pat)?.id ?? 'custom';
  const textBox = textInput({
    label: `Text (up to ${MAX_TEXT})`,
    value: settings.text,
    maxLength: MAX_TEXT,
    onChange(value) {
      settings.text = clean(value, MAX_TEXT);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const patternBox = textInput({
    label: `Pattern (up to ${MAX_PATTERN})`,
    value: settings.pat,
    maxLength: MAX_PATTERN,
    onChange(value) {
      settings.pat = clean(value, MAX_PATTERN);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const setInput = (text: string, pattern: string) => {
    settings.text = textBox.input.value = text;
    settings.pat = patternBox.input.value = pattern;
    preset.input.value = presetOf();
    rebuild();
  };
  const preset = select<string>({
    label: 'Preset',
    options: [...PRESETS, { id: 'custom', name: 'Custom' }],
    value: presetOf(),
    onChange(id) {
      const found = PRESETS.find((p) => p.id === id);
      if (found) setInput(found.text, found.pattern);
    },
  });

  panel.append(
    fieldset(
      'Search',
      select<Matcher>({
        label: 'Algorithm',
        options: MATCHERS,
        value: matcher(),
        onChange(id) {
          settings.alg = id;
          rebuild();
        },
      }).root,
      textBox.root,
      patternBox.root,
      preset.root,
      button('Randomise', () => {
        // Two letters only, and a pattern cut from the text, so partial matches are common.
        const random = seeded(newSeed());
        const length = randomInt(random, 16, 22);
        const text = Array.from({ length }, () => 'ab'[randomInt(random, 0, 1)]).join('');
        const size = randomInt(random, 3, 5);
        const at = randomInt(random, 0, length - size);
        setInput(text, text.slice(at, at + size));
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    answer,
    legend([
      ['var(--canvas-good)', 'Known to match'],
      ['var(--canvas-change)', 'Mismatch / value written'],
      ['var(--canvas-compare)', 'Letters compared / value read'],
      ['var(--canvas-accent)', 'Underline: a whole match'],
      ['var(--canvas-series-5)', 'Z-box'],
    ]),
  );

  about.append(
    prose(
      'The naive matcher lines the pattern up at every position and compares from its first letter each time, which can cost `O(nm)` comparisons. Both algorithms here first study the pattern, then scan the text in `O(n + m)` without ever stepping back in it.',
    ),
    prose(
      'KMP builds a failure table: `fail[i]` is the length of the longest proper prefix of `pattern[0..i]` that is also its suffix (a border). On a mismatch after `j` matched letters, the last `fail[j-1]` of them are already known to equal the start of the pattern, so the pattern slides forward by `j − fail[j-1]` and the comparison continues at the same text letter.',
    ),
    formula(
      'fail[0] = 0\nfail[i]: k = fail[i-1]; while k > 0 and p[i] ≠ p[k]: k = fail[k-1]\n         if p[i] = p[k]: k = k + 1;  fail[i] = k\n\nZ[i] = length of the longest common prefix of s and s[i..]\ninside the box [l, r):  Z[i] ≥ min(r − i, Z[i − l])',
    ),
    prose(
      'The Z algorithm keeps a box `[l, r)`: the rightmost stretch known to equal a prefix. A position inside the box copies the value from its mirror position near the start, and only compares letters past the box’s right edge. Running it over the pattern, then the text (as if they were joined by a separator that matches nothing), gives `Zt[i]`, how much of the pattern matches at text position `i`; a value equal to the pattern’s length is a match.',
    ),
    prose(
      'The counters split comparisons into those spent on the table and those spent in the text. The naive total is for the search alone, stopping each attempt at its first mismatch.',
    ),
  );

  rebuild();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
