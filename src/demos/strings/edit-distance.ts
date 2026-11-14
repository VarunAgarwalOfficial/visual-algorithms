import { editDistance, type EditKind, type EditResult } from '../../core/strings/dp';
import { newSeed, randomInt, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette, type Palette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clean, drawLetters, drawTable, FONT, glyph, phases, type Cell } from './table';
import { MONO } from '../../ui/font';

const MAX = 10;
const PRESETS = [
  { id: 'kitten', name: 'kitten → sitting', a: 'kitten', b: 'sitting' },
  { id: 'sunday', name: 'sunday → saturday', a: 'sunday', b: 'saturday' },
  { id: 'intention', name: 'intention → execution', a: 'intention', b: 'execution' },
  { id: 'flaw', name: 'flaw → lawn', a: 'flaw', b: 'lawn' },
  { id: 'horse', name: 'horse → ros', a: 'horse', b: 'ros' },
] as const;
const WORDS = [
  'planet',
  'garden',
  'stream',
  'window',
  'silver',
  'market',
  'bridge',
  'candle',
  'forest',
  'pocket',
  'winter',
  'school',
];

const opColour = (palette: Palette, kind: EditKind) =>
  kind === 'match'
    ? palette.good
    : kind === 'substitute'
      ? palette.compare
      : kind === 'insert'
        ? palette.series[2]
        : palette.change;

/** A word with a few random edits applied, so the pair is related but not identical. */
function mutate(word: string, random: () => number): string {
  const letters = [...word];
  const edits = randomInt(random, 2, 4);
  for (let k = 0; k < edits; k++) {
    const at = randomInt(random, 0, letters.length - 1);
    const ch = 'aeilnorst'[randomInt(random, 0, 8)];
    const kind = randomInt(random, 0, 2);
    if (kind === 0) letters[at] = ch;
    else if (kind === 1 && letters.length < MAX) letters.splice(at, 0, ch);
    else if (letters.length > 2) letters.splice(at, 1);
  }
  return letters.join('');
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Edit distance table being filled cell by cell, with the two words aligned underneath.',
  );

  const url = urlState({ a: 'kitten', b: 'sitting', sub: 1, speed: 8 });
  const settings = url.state;
  settings.a = clean(settings.a, MAX);
  settings.b = clean(settings.b, MAX);
  settings.sub = settings.sub === 2 ? 2 : 1;

  let result: EditResult = editDistance('', '');
  let fillSteps = 0;
  let position = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const counters = stats({ cells: 'Cells filled', distance: 'Distance', ops: 'Edits' });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const answer = el('p', { class: 'note', style: 'flex-basis: 100%' });

  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 200,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      update();
    },
  });

  const cellOf = (step: number): Cell => {
    const m = settings.b.length;
    return [Math.floor(step / m) + 1, (step % m) + 1];
  };

  function rebuild() {
    result = editDistance(settings.a, settings.b, settings.sub);
    fillSteps = settings.a.length * settings.b.length;
    url.save();
    player.setLength(fillSteps + result.ops.length);
  }

  function describe(): string {
    const { a, b, sub } = settings;
    const { filled, back } = phases(position, fillSteps);
    const T = result.table;
    if (back > 0) {
      const [i, j] = result.path[back - 1];
      const op = result.ops[result.ops.length - back];
      const from = `D[${i}][${j}] = ${T[i][j]}`;
      if (op.kind === 'match')
        return `Back from ${from}: '${glyph(op.from)}' matches, go diagonally at no cost.`;
      if (op.kind === 'substitute')
        return `Back from ${from}: came from D[${i - 1}][${j - 1}] + ${sub}, substitute '${glyph(op.from)}' with '${glyph(op.to)}'.`;
      if (op.kind === 'delete')
        return `Back from ${from}: came from D[${i - 1}][${j}] + 1, delete '${glyph(op.from)}'.`;
      return `Back from ${from}: came from D[${i}][${j - 1}] + 1, insert '${glyph(op.to)}'.`;
    }
    if (filled === 0) {
      return a.length + b.length === 0
        ? 'Both words are empty, so the distance is 0.'
        : 'Row 0 and column 0 are the base cases: turning an empty prefix into j letters takes j insertions, and i letters into nothing takes i deletions.';
    }
    const [i, j] = cellOf(filled - 1);
    const same = a[i - 1] === b[j - 1];
    const cost = same ? 0 : sub;
    return `D[${i}][${j}] = min(D[${i - 1}][${j}]+1, D[${i}][${j - 1}]+1, D[${i - 1}][${j - 1}]+${cost}) = min(${T[i - 1][j] + 1}, ${T[i][j - 1] + 1}, ${T[i - 1][j - 1] + cost}) = ${T[i][j]}. '${glyph(a[i - 1])}' and '${glyph(b[j - 1])}' ${same ? 'match' : 'differ'}.`;
  }

  function update() {
    draw();
    const { filled, back } = phases(position, fillSteps);
    const done = position >= player.length;
    const shown = result.ops.slice(result.ops.length - back);
    counters.set({
      cells: `${filled} / ${fillSteps}`,
      distance: filled >= fillSteps ? result.distance : '–',
      ops: back > 0 || done ? shown.filter((op) => op.kind !== 'match').length : '–',
    });
    status.textContent = describe();
    if (done && result.ops.length > 0) {
      const list = result.ops.map((op) =>
        op.kind === 'match'
          ? `keep ${glyph(op.from)}`
          : op.kind === 'substitute'
            ? `substitute ${glyph(op.from)}→${glyph(op.to)}${settings.sub === 2 ? ' (cost 2)' : ''}`
            : op.kind === 'insert'
              ? `insert ${glyph(op.to)}`
              : `delete ${glyph(op.from)}`,
      );
      answer.textContent = `Distance ${result.distance}. Reading left to right: ${list.join(', ')}.`;
    } else answer.textContent = '';
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { a, b } = settings;
    ctx.clearRect(0, 0, width, height);
    const pad = Math.max(6, width * 0.02);
    const { filled, back } = phases(position, fillSteps);
    const m = b.length;
    const stripH = height * 0.25;

    const current = back === 0 && filled > 0 ? cellOf(filled - 1) : undefined;
    drawTable(ctx, palette, {
      x: pad,
      y: pad,
      w: width - 2 * pad,
      h: height - stripH - 2 * pad,
      rowHead: ['ε', ...[...a].map(glyph)],
      colHead: ['ε', ...[...b].map(glyph)],
      indices: true,
      value: (r, c) =>
        r === 0 || c === 0 || (r - 1) * m + (c - 1) < filled
          ? String(result.table[r][c])
          : undefined,
      current,
      reads: current
        ? [
            [current[0] - 1, current[1]],
            [current[0], current[1] - 1],
            [current[0] - 1, current[1] - 1],
          ]
        : [],
      path:
        back > 0 || (position >= player.length && fillSteps === 0)
          ? result.path.slice(0, back + 1)
          : [],
    });

    // The strip under the table: the two prefixes while filling, the alignment while tracing back.
    const ops = result.ops;
    const columns = Math.max(a.length, m, ops.length, 1);
    const labelW = Math.min(64, width * 0.16);
    const slot = Math.min(26, (width - 2 * pad - labelW) / columns);
    const size = Math.max(8, Math.min(18, slot * 0.8, stripH * 0.26));
    const x0 = pad + labelW + (width - 2 * pad - labelW - slot * columns) / 2;
    const yA = height - stripH + stripH * 0.22;
    const yB = height - stripH + stripH * 0.78;
    const yMid = (yA + yB) / 2;

    ctx.font = `${Math.max(8, Math.min(12, size * 0.75))}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    ctx.fillText('from', pad, yA);
    ctx.fillText('to', pad, yB);

    if (back === 0) {
      const [i, j] = current ?? (filled >= fillSteps && fillSteps > 0 ? [a.length, m] : [0, 0]);
      drawLetters(ctx, [...a], x0, yA, slot, size, (k) => (k < i ? palette.ink : palette.muted));
      drawLetters(ctx, [...b], x0, yB, slot, size, (k) => (k < j ? palette.ink : palette.muted));
      // Underline the two prefixes the current cell is about.
      ctx.strokeStyle = palette.change;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (i > 0) {
        ctx.moveTo(x0 + 2, yA + size * 0.7);
        ctx.lineTo(x0 + slot * i - 2, yA + size * 0.7);
      }
      if (j > 0) {
        ctx.moveTo(x0 + 2, yB + size * 0.7);
        ctx.lineTo(x0 + slot * j - 2, yB + size * 0.7);
      }
      ctx.stroke();
      return;
    }

    const first = ops.length - back;
    ctx.textAlign = 'center';
    for (let k = first; k < ops.length; k++) {
      const op = ops[k];
      const colour = opColour(palette, op.kind);
      const cx = x0 + slot * (k + 0.5);
      ctx.font = `${size}px ${MONO}`;
      ctx.fillStyle = op.from ? (op.kind === 'match' ? palette.ink : colour) : palette.muted;
      ctx.fillText(op.from ? glyph(op.from) : '–', cx, yA);
      ctx.fillStyle = op.to ? (op.kind === 'match' ? palette.ink : colour) : palette.muted;
      ctx.fillText(op.to ? glyph(op.to) : '–', cx, yB);
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 1.5;
      const half = Math.min(slot * 0.28, (yB - yA) * 0.16);
      ctx.beginPath();
      if (op.kind === 'match') {
        ctx.moveTo(cx, yMid - half);
        ctx.lineTo(cx, yMid + half);
      } else if (op.kind === 'substitute') {
        ctx.moveTo(cx - half, yMid - half);
        ctx.lineTo(cx + half, yMid + half);
        ctx.moveTo(cx + half, yMid - half);
        ctx.lineTo(cx - half, yMid + half);
      } else if (op.kind === 'insert') {
        ctx.moveTo(cx - half, yMid);
        ctx.lineTo(cx + half, yMid);
        ctx.moveTo(cx, yMid - half);
        ctx.lineTo(cx, yMid + half);
      } else {
        ctx.moveTo(cx - half, yMid);
        ctx.lineTo(cx + half, yMid);
      }
      ctx.stroke();
    }
  }

  // --- Controls ---

  const presetOf = () =>
    PRESETS.find((p) => p.a === settings.a && p.b === settings.b)?.id ?? 'custom';
  const inputA = textInput({
    label: `From (up to ${MAX} letters)`,
    value: settings.a,
    maxLength: MAX,
    onChange(value) {
      settings.a = clean(value, MAX);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const inputB = textInput({
    label: `To (up to ${MAX} letters)`,
    value: settings.b,
    maxLength: MAX,
    onChange(value) {
      settings.b = clean(value, MAX);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const setWords = (a: string, b: string) => {
    settings.a = inputA.input.value = a;
    settings.b = inputB.input.value = b;
    preset.input.value = presetOf();
    rebuild();
  };
  const preset = select<string>({
    label: 'Preset',
    options: [...PRESETS, { id: 'custom', name: 'Custom' }],
    value: presetOf(),
    onChange(id) {
      const found = PRESETS.find((p) => p.id === id);
      if (found) setWords(found.a, found.b);
    },
  });

  panel.append(
    fieldset(
      'Words',
      inputA.root,
      inputB.root,
      preset.root,
      el(
        'div',
        { class: 'buttons' },
        button('Randomise', () => {
          const random = seeded(newSeed());
          const word = WORDS[randomInt(random, 0, WORDS.length - 1)];
          setWords(word, mutate(word, random));
        }),
        button('Swap', () => setWords(settings.b, settings.a)),
      ),
      select<string>({
        label: 'Substitution cost',
        options: [
          { id: '1', name: '1 (Levenshtein)' },
          { id: '2', name: '2 (same as delete + insert)' },
        ],
        value: String(settings.sub),
        onChange(value) {
          settings.sub = value === '2' ? 2 : 1;
          rebuild();
        },
      }).root,
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    answer,
    legend([
      ['var(--canvas-change)', 'Cell being computed / delete'],
      ['var(--canvas-compare)', 'Cells it reads / substitute'],
      ['var(--canvas-good)', 'Traceback / match'],
      ['var(--canvas-series-3)', 'Insert'],
    ]),
  );

  about.append(
    prose(
      'The edit distance between two words is the smallest number of single-letter insertions, deletions and substitutions that turns one into the other. `D[i][j]` is the answer for the first `i` letters of the source and the first `j` letters of the target, so every cell is a smaller version of the same question.',
    ),
    formula(
      'D[i][0] = i        D[0][j] = j\nD[i][j] = min( D[i-1][j] + 1,                 delete a[i]\n               D[i][j-1] + 1,                 insert b[j]\n               D[i-1][j-1] + (a[i] = b[j] ? 0 : s) )   match or substitute',
    ),
    prose(
      'Each cell reads only its upper, left and upper-left neighbours, so the table is filled row by row in `O(nm)` time. The bottom right cell is the distance. Walking back from it, always to a neighbour that explains the value, recovers one cheapest sequence of edits; drawn as columns, that is an alignment of the two words.',
    ),
    prose(
      'With substitution cost `s = 2` a substitution is no better than a deletion plus an insertion. The distance then counts only insertions and deletions, which is what a line-based diff reports.',
    ),
  );

  rebuild();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
