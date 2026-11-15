import { huffman, type Huffman, type HuffNode } from '../../core/strings/huffman';
import { newSeed, randomInt, seeded, shuffle } from '../../core/random';
import { createLoop, createStage } from '../../ui/canvas';
import { button, el, fieldset, select, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { mix, prefersReducedMotion, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { clean, FONT, glyph } from './table';
import { drawHint, labelSize } from '../../ui/font';

const MAX_TEXT = 60;
const MAX_SYMBOLS = 12;
const PRESETS = [
  { id: 'abra', name: 'abracadabra', text: 'abracadabra' },
  { id: 'miss', name: 'mississippi river', text: 'mississippi river' },
  { id: 'skew', name: 'Very uneven counts', text: 'aaaaaaaaaaaaaaaabbbbbbbbccccdde' },
  { id: 'even', name: 'All equal (no saving)', text: 'abcdefghabcdefgh' },
  { id: 'fib', name: 'Fibonacci counts (tall tree)', text: 'abccdddeeeeefffffffffggggggggggggg' },
] as const;

/** Cuts the text and drops letters beyond the first MAX_SYMBOLS distinct ones. */
function limit(text: string): string {
  const seen = new Set<string>();
  let out = '';
  for (const ch of clean(text, MAX_TEXT)) {
    if (!seen.has(ch) && seen.size === MAX_SYMBOLS) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

type Point = { x: number; y: number };

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A row of subtrees ordered by weight. The two lightest are merged under a new parent until one Huffman tree remains.',
  );

  const url = urlState({ text: 'abracadabra', speed: 2 });
  const settings = url.state;
  settings.text = limit(settings.text);

  let h: Huffman = huffman('');
  let depth = 0; // height of the final tree, in edges
  let position = 0;
  let previous = -1;

  // Node positions move between layouts: `from` to `target` as `t` runs 0..1.
  let from = new Map<number, Point>();
  let target = new Map<number, Point>();
  let t = 1;
  let radius = 10;
  let slotWidth = 20;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => {
    layout();
    from = target;
    t = 1;
    draw();
  });
  const loop = createLoop((dt) => {
    t = Math.min(1, t + dt / 0.35);
    draw();
    if (t >= 1) loop.stop();
  });

  const counters = stats({
    merges: 'Merges',
    bits: 'Huffman bits',
    fixed: 'Fixed-length bits',
    saved: 'Saved',
    average: 'Bits per symbol',
    entropy: 'Entropy H',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const answer = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const table = el('pre', { class: 'formula', style: 'flex-basis: 100%; margin: 0' });

  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 20,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      const single = Math.abs(position - previous) === 1;
      previous = position;
      const before = new Map([...target.keys()].map((id) => [id, place(id)] as const));
      layout();
      // A node that has just appeared grows out from between its children.
      from = new Map(
        [...target.keys()].map((id) => {
          const node = h.nodes[id];
          const a = node.left && before.get(node.left.id);
          const b = node.right && before.get(node.right.id);
          const start =
            before.get(id) ??
            (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : target.get(id));
          return [id, start ?? { x: 0, y: 0 }] as const;
        }),
      );
      if (single && !prefersReducedMotion() && before.size > 0) {
        t = 0;
        loop.start();
      } else {
        t = 1;
        loop.stop();
      }
      update();
    },
  });

  const mergesDone = () => Math.min(h.merges.length, Math.floor(position / 2));
  /** True on the step that only points at the two lightest trees. */
  const picking = () => position % 2 === 1 && position < 2 * h.merges.length;
  const done = () => position >= player.length;

  function place(id: number): Point {
    const to = target.get(id) ?? { x: 0, y: 0 };
    const start = from.get(id) ?? to;
    const e = t * t * (3 - 2 * t);
    return { x: start.x + (to.x - start.x) * e, y: start.y + (to.y - start.y) * e };
  }

  function layout() {
    const { width, height } = stage;
    const queue = h.queues[mergesDone()] ?? [];
    const leaves = Math.max(1, h.symbols.length);
    const pad = Math.max(8, width * 0.025);
    const gap = queue.length > 1 ? Math.min(14, (width * 0.12) / (queue.length - 1)) : 0;
    const slot = Math.min(96, (width - 2 * pad - gap * (queue.length - 1)) / leaves);
    const small = Math.max(7, Math.min(12, slot * 0.42));
    slotWidth = slot;
    const top = pad + small * 2.2;
    const bottom = height - pad - small * 3.4;
    radius = Math.max(5, Math.min(22, slot * 0.42, (bottom - top) / (2.6 * (depth + 1))));
    const level = Math.min(96, depth > 0 ? (bottom - top - 2 * radius) / depth : 0);
    const used = slot * leaves + gap * (queue.length - 1);
    let cursor = (width - used) / 2;

    target = new Map();
    const walk = (node: HuffNode, d: number): number => {
      let x: number;
      if (node.left && node.right) x = (walk(node.left, d + 1) + walk(node.right, d + 1)) / 2;
      else {
        x = cursor + slot / 2;
        cursor += slot;
      }
      target.set(node.id, { x, y: top + radius + d * level });
      return x;
    };
    for (const id of queue) {
      walk(h.nodes[id], 0);
      cursor += gap;
    }
  }

  function rebuild() {
    h = huffman(settings.text);
    const height = (node: HuffNode | undefined): number =>
      node?.left && node.right ? 1 + Math.max(height(node.left), height(node.right)) : 0;
    depth = height(h.root);
    from = new Map();
    target = new Map();
    previous = -1;
    url.save();
    player.setLength(h.symbols.length === 0 ? 0 : 2 * h.merges.length + 1);
  }

  const name = (id: number) => {
    const node = h.nodes[id];
    return node.symbol !== undefined
      ? `'${glyph(node.symbol)}' (${node.weight})`
      : `the tree of weight ${node.weight}`;
  };

  function update() {
    draw();
    const k = mergesDone();
    const finished = done();
    const fixed = h.total * h.fixedWidth;
    counters.set({
      merges: `${k} / ${h.merges.length}`,
      bits: finished ? h.encodedBits : '–',
      fixed: h.symbols.length ? fixed : '–',
      saved: finished ? fixed - h.encodedBits : '–',
      average: finished && h.total ? (h.encodedBits / h.total).toFixed(3) : '–',
      entropy: h.total ? h.entropy.toFixed(3) : '–',
    });

    if (h.symbols.length === 0) status.textContent = 'Type some text to encode.';
    else if (finished) {
      status.textContent =
        h.symbols.length === 1
          ? 'Only one symbol, so the tree is a single leaf. It still needs one bit per symbol.'
          : 'One tree is left. Each code is the path from the root to the leaf: 0 for a left branch, 1 for a right branch.';
    } else if (position === 0) {
      status.textContent = `Each symbol starts as its own tree, weighted by its count and ordered lightest first. Ties go to the earlier symbol, and to leaves before merged trees.`;
    } else if (picking()) {
      const merge = h.merges[k];
      status.textContent = `The two lightest trees are ${name(merge.a)} and ${name(merge.b)}.`;
    } else {
      const merge = h.merges[k - 1];
      const queue = h.queues[k];
      const at = queue.indexOf(merge.parent) + 1;
      status.textContent = `Merge them under a new node of weight ${h.nodes[merge.a].weight} + ${h.nodes[merge.b].weight} = ${h.nodes[merge.parent].weight}. It rejoins the queue at place ${at} of ${queue.length}.`;
    }

    answer.textContent =
      finished && h.symbols.length > 0
        ? `Encoded length ${h.encodedBits} bits. A fixed-length code needs ${h.fixedWidth} bit${h.fixedWidth === 1 ? '' : 's'} for each of the ${h.total} symbols (${h.symbols.length} distinct), ${fixed} bits: ${fixed - h.encodedBits} saved. Average ${(h.encodedBits / h.total).toFixed(3)} bits per symbol against an entropy of ${h.entropy.toFixed(3)}.`
        : '';

    const rows = h.symbols.map(({ symbol, count }) => {
      const code = finished ? (h.codes.get(symbol) ?? '') : '';
      return `${glyph(symbol).padEnd(8)}${String(count).padEnd(7)}${
        finished ? `${code.padEnd(Math.max(6, depth + 2))}${count * code.length}` : '–'
      }`;
    });
    table.textContent = h.symbols.length
      ? [
          `symbol  count  code${finished ? ' '.repeat(Math.max(2, depth - 2)) + 'bits' : ''}`,
          ...rows,
        ].join('\n')
      : '';
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    if (h.symbols.length === 0) {
      drawHint(ctx, width, height, palette.muted, 'Type some text to encode.');
      return;
    }
    const k = mergesDone();
    const queue = h.queues[k];
    const finished = done();
    const pad = Math.max(8, width * 0.025);
    const small = Math.max(7, Math.min(12, radius * 0.95));

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${labelSize(Math.max(9, Math.min(12, width * 0.028)))}px ${FONT}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText(
      queue.length > 1 ? 'Queue of trees, lightest first →' : 'Huffman tree',
      pad,
      pad + small * 0.6,
    );

    const merge = picking() ? h.merges[k] : undefined;
    const fresh = !picking() && position > 0 && !finished ? h.merges[k - 1]?.parent : undefined;
    const alive = h.symbols.length + k;

    // Edges first, with their bit labels.
    ctx.lineWidth = 1.25;
    for (let id = h.symbols.length; id < alive; id++) {
      const node = h.nodes[id];
      const p = place(id);
      [node.left, node.right].forEach((child, bit) => {
        if (!child) return;
        const c = place(child.id);
        ctx.strokeStyle = finished ? palette.accent : palette.muted;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
        const mx = (p.x + c.x) / 2;
        const my = (p.y + c.y) / 2;
        const side = bit === 0 ? -1 : 1;
        ctx.font = `${labelSize(small)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = finished ? palette.ink : palette.muted;
        ctx.fillText(String(bit), mx + side * (small * 0.75), my - small * 0.35);
      });
    }

    for (let id = 0; id < alive; id++) {
      const node = h.nodes[id];
      const p = place(id);
      const leaf = node.symbol !== undefined;
      const picked = merge && (id === merge.a || id === merge.b);
      const stroke = picked
        ? palette.compare
        : id === fresh
          ? palette.change
          : leaf
            ? palette.accent
            : palette.muted;
      ctx.fillStyle = picked
        ? mix(palette.bg, palette.compare, 0.35)
        : id === fresh
          ? mix(palette.bg, palette.change, 0.3)
          : leaf
            ? mix(palette.bg, finished ? palette.good : palette.accent, 0.22)
            : palette.bg;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = picked || id === fresh ? 2 : 1.25;
      ctx.beginPath();
      if (leaf) ctx.rect(p.x - radius, p.y - radius, 2 * radius, 2 * radius);
      else ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = palette.ink;
      if (leaf) {
        ctx.font = `600 ${labelSize(Math.max(8, radius * 1.15))}px ${FONT}`;
        ctx.fillText(glyph(node.symbol ?? ''), p.x, p.y + 0.5);
        ctx.font = `${labelSize(small)}px ${FONT}`;
        ctx.fillStyle = palette.muted;
        ctx.fillText(String(node.weight), p.x, p.y + radius + small * 0.9);
        if (finished) {
          const code = h.codes.get(node.symbol ?? '') ?? '';
          const fit = Math.min(small, (slotWidth * 0.86) / (Math.max(1, code.length) * 0.6));
          ctx.font = `${labelSize(Math.max(6, fit))}px ${FONT}`;
          ctx.fillStyle = palette.ink;
          ctx.fillText(code, p.x, p.y + radius + small * 2.1);
        }
      } else {
        const label = String(node.weight);
        ctx.font = `${labelSize(Math.max(7, Math.min(radius * 1.05, (radius * 3) / label.length)))}px ${FONT}`;
        ctx.fillText(label, p.x, p.y + 0.5);
      }
    }
  }

  // --- Controls ---

  const presetOf = () => PRESETS.find((p) => p.text === settings.text)?.id ?? 'custom';
  const hint = el('p', { class: 'note' });
  const showHint = (typed: string) => {
    hint.textContent =
      limit(typed) === clean(typed, MAX_TEXT)
        ? ''
        : `Only the first ${MAX_SYMBOLS} distinct symbols are used; later new ones are left out.`;
  };
  const textBox = textInput({
    label: `Text (up to ${MAX_TEXT} characters)`,
    value: settings.text,
    maxLength: MAX_TEXT,
    onChange(value) {
      settings.text = limit(value);
      preset.input.value = presetOf();
      showHint(value);
      rebuild();
    },
  });
  const setText = (text: string) => {
    settings.text = textBox.input.value = limit(text);
    preset.input.value = presetOf();
    showHint(text);
    rebuild();
  };
  const preset = select<string>({
    label: 'Preset',
    options: [...PRESETS, { id: 'custom', name: 'Custom' }],
    value: presetOf(),
    onChange(id) {
      const found = PRESETS.find((p) => p.id === id);
      if (found) setText(found.text);
    },
  });

  panel.append(
    fieldset(
      'Text',
      textBox.root,
      hint,
      preset.root,
      button('Randomise', () => {
        // A handful of letters with uneven counts, shuffled into a string.
        const random = seeded(newSeed());
        const distinct = randomInt(random, 4, 8);
        const letters: string[] = [];
        for (let i = 0; i < distinct; i++) {
          const count = Math.max(1, Math.round(12 * random() ** 2.2));
          for (let c = 0; c < count; c++) letters.push('abcdefgh'[i]);
        }
        setText(shuffle(letters, random).join(''));
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    answer,
    table,
    legend([
      ['var(--canvas-compare)', 'Two lightest trees'],
      ['var(--canvas-change)', 'New parent'],
      ['var(--canvas-accent)', 'Leaf (symbol and count)'],
    ]),
  );

  about.append(
    prose(
      'A fixed-length code spends the same number of bits on every symbol. Huffman coding gives frequent symbols short codes and rare ones long codes, in such a way that no code is the start of another, so the bits can be read back without separators.',
    ),
    prose(
      'The construction is greedy. Put every symbol in a queue ordered by count. Take out the two lightest trees, join them under a new node whose weight is their sum, and put that back. Repeat until one tree is left. The two rarest symbols end up deepest, which is exactly where the longest codes should go. With a heap the whole thing takes `O(k log k)` for `k` distinct symbols.',
    ),
    formula(
      'encoded bits = Σ count(s) · depth(s)\nH = − Σ p(s) · log2 p(s)        with p(s) = count(s) / n\nH ≤ average bits per symbol < H + 1',
    ),
    prose(
      'The entropy `H` is the lower bound for any code that treats symbols one at a time. Huffman meets it exactly when every probability is a power of one half, and is otherwise within one bit per symbol. The count ignores the cost of sending the tree itself. Ties are broken the same way every time here, by weight and then by age, so the same text always gives the same tree; other tie rules give different trees with the same total length.',
    ),
  );

  showHint(settings.text);
  rebuild();

  return () => {
    loop.stop();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
