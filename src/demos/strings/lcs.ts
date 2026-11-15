import { lcs, type LcsResult } from '../../core/strings/dp';
import { newSeed, randomInt, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clean, drawLetters, drawTable, FONT, glyph, phases, type Cell } from './table';
import { labelSize } from '../../ui/font';

const MAX = 10;
const PRESETS = [
  { id: 'dna', name: 'AGGTAB / GXTXAYB', a: 'AGGTAB', b: 'GXTXAYB' },
  { id: 'clrs', name: 'ABCBDAB / BDCABA', a: 'ABCBDAB', b: 'BDCABA' },
  { id: 'human', name: 'HUMAN / CHIMPANZEE', a: 'HUMAN', b: 'CHIMPANZEE' },
  { id: 'diff', name: 'the cats / that cat', a: 'the cats', b: 'that cat' },
  { id: 'none', name: 'abc / xyz (nothing shared)', a: 'abc', b: 'xyz' },
] as const;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Longest common subsequence table being filled, with the two strings and their matched letters joined underneath.',
  );

  const url = urlState({ a: 'AGGTAB', b: 'GXTXAYB', speed: 8 });
  const settings = url.state;
  settings.a = clean(settings.a, MAX);
  settings.b = clean(settings.b, MAX);

  let result: LcsResult = lcs('', '');
  let fillSteps = 0;
  let position = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const counters = stats({ cells: 'Cells filled', length: 'LCS length', found: 'Letters traced' });
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
  const backSteps = () => result.path.length - 1;

  function rebuild() {
    result = lcs(settings.a, settings.b);
    fillSteps = settings.a.length * settings.b.length;
    url.save();
    player.setLength(fillSteps + backSteps());
  }

  /** Matched pairs found after `back` traceback steps (they are found last to first). */
  function pairsAfter(back: number): Cell[] {
    let count = 0;
    for (let k = 0; k < back; k++) {
      const [i, j] = result.path[k];
      if (settings.a[i - 1] === settings.b[j - 1]) count++;
    }
    return result.pairs.slice(result.pairs.length - count);
  }

  function describe(): string {
    const { a, b } = settings;
    const { filled, back } = phases(position, fillSteps);
    const T = result.table;
    if (back > 0) {
      const [i, j] = result.path[back - 1];
      const [ni, nj] = result.path[back];
      const tail =
        back === backSteps() ? ' The table edge is reached, so the traceback is complete.' : '';
      if (a[i - 1] === b[j - 1])
        return `Back from L[${i}][${j}] = ${T[i][j]}: '${glyph(a[i - 1])}' is in both, keep it and go diagonally.${tail}`;
      return `Back from L[${i}][${j}] = ${T[i][j]}: letters differ, move ${ni < i ? 'up' : 'left'} to L[${ni}][${nj}] = ${T[ni][nj]}, the larger neighbour.${tail}`;
    }
    if (filled === 0) {
      return fillSteps === 0
        ? 'One string is empty, so nothing is shared.'
        : 'Row 0 and column 0 are 0: an empty prefix shares nothing.';
    }
    const [i, j] = cellOf(filled - 1);
    if (a[i - 1] === b[j - 1])
      return `'${glyph(a[i - 1])}' = '${glyph(b[j - 1])}', so L[${i}][${j}] = L[${i - 1}][${j - 1}] + 1 = ${T[i][j]}.`;
    return `'${glyph(a[i - 1])}' ≠ '${glyph(b[j - 1])}', so L[${i}][${j}] = max(L[${i - 1}][${j}], L[${i}][${j - 1}]) = max(${T[i - 1][j]}, ${T[i][j - 1]}) = ${T[i][j]}.`;
  }

  function update() {
    draw();
    const { filled, back } = phases(position, fillSteps);
    const done = position >= player.length;
    counters.set({
      cells: `${filled} / ${fillSteps}`,
      length: filled >= fillSteps ? result.length : '–',
      found: back > 0 || done ? pairsAfter(back).length : '–',
    });
    status.textContent = describe();
    const { a, b } = settings;
    answer.textContent = !done
      ? ''
      : result.length === 0
        ? 'The strings share no letters, so the LCS is empty.'
        : `LCS "${result.subsequence}", length ${result.length}. As a diff: keep those letters, delete the other ${a.length - result.length} of the first string and insert the other ${b.length - result.length} of the second.`;
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { a, b } = settings;
    ctx.clearRect(0, 0, width, height);
    const pad = Math.max(6, width * 0.02);
    const { filled, back } = phases(position, fillSteps);
    const done = position >= player.length;
    const m = b.length;
    const stripH = height * 0.25;

    const current = back === 0 && filled > 0 && !done ? cellOf(filled - 1) : undefined;
    const same = current ? a[current[0] - 1] === b[current[1] - 1] : false;
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
      reads: !current
        ? []
        : same
          ? [[current[0] - 1, current[1] - 1]]
          : [
              [current[0] - 1, current[1]],
              [current[0], current[1] - 1],
            ],
      path: back > 0 ? result.path.slice(0, back + 1) : [],
    });

    // The two strings, with lines joining the matched letters found so far.
    const columns = Math.max(a.length, m, 1);
    const labelW = Math.min(40, width * 0.1);
    const slot = Math.min(28, (width - 2 * pad - labelW) / columns);
    const size = Math.max(8, Math.min(18, slot * 0.8, stripH * 0.26));
    const xA = pad + labelW + (width - 2 * pad - labelW - slot * a.length) / 2;
    const xB = pad + labelW + (width - 2 * pad - labelW - slot * m) / 2;
    const yA = height - stripH + stripH * 0.2;
    const yB = height - stripH + stripH * 0.8;

    ctx.font = `${labelSize(Math.max(8, Math.min(12, size * 0.75)))}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    ctx.fillText('A', pad, yA);
    ctx.fillText('B', pad, yB);

    const pairs = pairsAfter(back);
    const inA = new Set(pairs.map(([p]) => p));
    const inB = new Set(pairs.map(([, p]) => p));
    const [pi, pj] = current ?? [a.length, m];
    drawLetters(ctx, [...a], xA, yA, slot, size, (k) =>
      inA.has(k) ? palette.good : done ? palette.change : k < pi ? palette.ink : palette.muted,
    );
    drawLetters(ctx, [...b], xB, yB, slot, size, (k) =>
      inB.has(k) ? palette.good : done ? palette.series[2] : k < pj ? palette.ink : palette.muted,
    );

    ctx.strokeStyle = palette.good;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [p, q] of pairs) {
      ctx.moveTo(xA + slot * (p + 0.5), yA + size * 0.7);
      ctx.lineTo(xB + slot * (q + 0.5), yB - size * 0.7);
    }
    ctx.stroke();

    if (current) {
      ctx.strokeStyle = palette.change;
      ctx.beginPath();
      ctx.moveTo(xA + 2, yA + size * 0.7);
      ctx.lineTo(xA + slot * pi - 2, yA + size * 0.7);
      ctx.moveTo(xB + 2, yB + size * 0.7);
      ctx.lineTo(xB + slot * pj - 2, yB + size * 0.7);
      ctx.stroke();
    }
  }

  // --- Controls ---

  const presetOf = () =>
    PRESETS.find((p) => p.a === settings.a && p.b === settings.b)?.id ?? 'custom';
  const inputA = textInput({
    label: `String A (up to ${MAX})`,
    value: settings.a,
    maxLength: MAX,
    onChange(value) {
      settings.a = clean(value, MAX);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const inputB = textInput({
    label: `String B (up to ${MAX})`,
    value: settings.b,
    maxLength: MAX,
    onChange(value) {
      settings.b = clean(value, MAX);
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const setStrings = (a: string, b: string) => {
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
      if (found) setStrings(found.a, found.b);
    },
  });

  panel.append(
    fieldset(
      'Strings',
      inputA.root,
      inputB.root,
      preset.root,
      el(
        'div',
        { class: 'buttons' },
        button('Randomise', () => {
          // A small alphabet, so that random strings share a fair amount.
          const random = seeded(newSeed());
          const word = () =>
            Array.from({ length: randomInt(random, 5, 9) }, () => 'ACGT'[randomInt(random, 0, 3)]);
          setStrings(word().join(''), word().join(''));
        }),
        button('Swap', () => setStrings(settings.b, settings.a)),
      ),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    answer,
    legend([
      ['var(--canvas-change)', 'Cell being computed / only in A'],
      ['var(--canvas-compare)', 'Cells it reads'],
      ['var(--canvas-good)', 'Traceback / shared letter'],
      ['var(--canvas-series-3)', 'Only in B'],
    ]),
  );

  about.append(
    prose(
      'A subsequence keeps some letters of a string in their original order, not necessarily next to each other. `L[i][j]` is the length of the longest subsequence shared by the first `i` letters of A and the first `j` letters of B.',
    ),
    formula(
      'L[i][0] = L[0][j] = 0\nL[i][j] = L[i-1][j-1] + 1               if a[i] = b[j]\n        = max( L[i-1][j], L[i][j-1] )    otherwise',
    ),
    prose(
      'If the last letters agree, one optimal answer ends with that letter, so the cell extends the diagonal. If not, at least one of the two last letters is unused, and the cell takes the better of dropping either. Filling takes `O(nm)` time. The traceback from the bottom right corner steps diagonally at each shared letter and otherwise towards the larger neighbour.',
    ),
    prose(
      'This is the core of `diff`. With lines in place of letters, the LCS is what two files have in common; everything else in the old file is reported as deleted and everything else in the new file as inserted. The number of such edits is `n + m − 2·LCS`.',
    ),
  );

  rebuild();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
