import { BinaryHeap, HEAP_CAPACITY, type HeapFrame } from '../../core/structures/heap';
import { button, checkbox, el, fieldset } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import { cellGrid, disc, drawCells, label, line, roleStyle, type Gfx } from './draw';
import { actFieldset, opForm, opsDemo, presetSelect, record, wholeNumber } from './shared';

const MAX_VALUE = 99;

/** "5, 3 8" or "5-3-8" to numbers; null when anything is not a value in range. */
function parseList(text: string): number[] | null {
  const parts = text.split(/[\s,;-]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > HEAP_CAPACITY) return null;
  const values = parts.map((part) => wholeNumber(part, 0, MAX_VALUE));
  return values.every((v): v is number => v !== null) ? values : null;
}

function clean(op: string): string | null {
  if (op === 'x') return op;
  if (op[0] === 'i') {
    const value = wholeNumber(op.slice(1), 0, MAX_VALUE);
    return value === null ? null : `i${value}`;
  }
  if (op[0] === 'h' || op[0] === 'n') {
    const values = parseList(op.slice(1));
    return values ? `${op[0]}${values.join('-')}` : null;
  }
  return null;
}

export const mount: Mount = (root, entry) => {
  const url = urlState({
    max: false,
    ops: 'h50-30-70-20-90-10-60-40-80-15-35-65',
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  const extreme = () => (settings.max ? 'max' : 'min');
  let values: number[] = [];

  const counters = stats({ size: 'Items', comparisons: 'Comparisons', swaps: 'Swaps' });
  const extracted = el('p', { class: 'note' });

  const demo = opsDemo<HeapFrame>({
    root,
    entry,
    canvasLabel:
      'The heap drawn as a tree above its backing array. The items in use are highlighted in both.',
    settings,
    save: url.save,
    clean,
    describe(op) {
      if (op === 'x') return `extract ${extreme()}`;
      if (op[0] === 'i') return `insert ${op.slice(1)}`;
      const n = op.split('-').length;
      return op[0] === 'h' ? `bottom-up build of ${n} values` : `build by ${n} inserts`;
    },
    run(ops) {
      const heap = new BinaryHeap(settings.max);
      const recording = record(heap.frames, ops, (op) => {
        if (op === 'x') heap.extract();
        else if (op[0] === 'i') heap.insert(Number(op.slice(1)));
        else heap.build(op.slice(1).split('-').map(Number), op[0] === 'h' ? 'floyd' : 'inserts');
      });
      values = heap.values();
      return recording;
    },
    draw,
    show(frame) {
      counters.set({
        size: frame.items.length,
        comparisons: frame.comparisons,
        swaps: frame.swaps,
      });
      extracted.textContent =
        frame.out.length === 0
          ? 'Nothing extracted yet.'
          : `Extracted so far: ${frame.out.join(', ')}.`;
    },
  });

  function draw(frame: HeapFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const n = frame.items.length;
    const pad = Math.max(8, width * 0.025);
    if (n === 0) {
      label(
        ctx,
        'Empty heap. Insert a value or build from an array.',
        width / 2,
        height / 2,
        palette.muted,
        13,
      );
      return;
    }
    // The array strip sits at the bottom; the tree takes what is left.
    const grid = cellGrid(n, { x: pad, y: 0, w: width - 2 * pad, h: height * 0.3 }, 19, 34);
    const stripTop = height - pad - grid.height;
    const strip = cellGrid(n, { x: pad, y: stripTop, w: width - 2 * pad, h: height * 0.3 }, 19, 34);

    const levels = Math.floor(Math.log2(n)) + 1;
    const treeHeight = stripTop - pad - 16;
    const slot = (width - 2 * pad) / 2 ** (levels - 1);
    const r = Math.max(6, Math.min(20, slot * 0.44, treeHeight / (levels * 2.6)));
    const gap = levels > 1 ? Math.min(84, (treeHeight - 2 * r) / (levels - 1)) : 0;
    const px = Math.max(8, Math.min(14, r * 0.95));
    const treeTop = pad + Math.min(treeHeight * 0.2, (treeHeight - 2 * r - gap * (levels - 1)) / 2);
    const spot = (i: number) => {
      const depth = Math.floor(Math.log2(i + 1));
      const k = i + 1 - 2 ** depth;
      return {
        x: pad + ((k + 0.5) / 2 ** depth) * (width - 2 * pad),
        y: treeTop + r + depth * gap,
      };
    };
    for (let i = 1; i < n; i++) line(ctx, spot((i - 1) >> 1), spot(i), palette.muted);
    frame.items.forEach((item, i) => {
      const rest = spot(i);
      // The slot stays put; only the value glides when two items swap.
      disc(ctx, rest, r, roleStyle(palette, frame.hi.get(i), px));
      const at = g.place(`node:${item.id}`, rest.x, rest.y);
      label(ctx, String(item.value), at.x, at.y + 0.5, palette.ink, px);
    });
    label(ctx, 'array', pad, stripTop - 9, palette.muted, 10, 'left');
    drawCells(
      g,
      frame.items.map((item, i) => ({
        id: item.id,
        text: String(item.value),
        role: frame.hi.get(i),
        sub: String(i),
      })),
      strip,
    );
  }

  const array = opForm({
    label: `Array (up to ${HEAP_CAPACITY} values, 0 to ${MAX_VALUE})`,
    value: '9 8 7 6 5 4 3 2 1',
    maxLength: 140,
    actions: [
      {
        name: 'Bottom-up',
        run: (text) => {
          const list = parseList(text);
          return list !== null && demo.push(`h${list.join('-')}`);
        },
      },
      {
        name: 'n inserts',
        run: (text) => {
          const list = parseList(text);
          return list !== null && demo.push(`n${list.join('-')}`);
        },
      },
    ],
  });
  let fills = 0;

  demo.layout.panel.append(
    actFieldset(
      'Operations',
      opForm({
        label: `Value (0 to ${MAX_VALUE})`,
        numeric: true,
        maxLength: 2,
        actions: [
          {
            name: 'Insert',
            run: (text) => {
              const value = wholeNumber(text, 0, MAX_VALUE);
              return value !== null && demo.push(`i${value}`);
            },
          },
          { name: 'Extract root', run: () => demo.push('x') },
        ],
      }).root,
    ),
    fieldset(
      'More operations',
      el(
        'div',
        { class: 'buttons' },
        button('Insert 10 random', () => {
          const random = demo.random();
          demo.push(
            ...Array.from(
              { length: Math.max(1, Math.min(10, HEAP_CAPACITY - values.length)) },
              () => `i${1 + Math.floor(random() * MAX_VALUE)}`,
            ),
          );
        }),
        button('Random operation', () => {
          const random = demo.random();
          demo.push(
            values.length >= HEAP_CAPACITY || (values.length > 0 && random() < 0.4)
              ? 'x'
              : `i${1 + Math.floor(random() * MAX_VALUE)}`,
          );
        }),
      ),
      checkbox({
        label: 'Max-heap (largest at the root)',
        checked: settings.max,
        onChange(on) {
          settings.max = on;
          demo.rebuild();
        },
      }),
    ),
    fieldset(
      'Build from an array',
      array.root,
      el(
        'div',
        { class: 'buttons' },
        button('Fill with random values', () => {
          const random = demo.random();
          for (let i = 0; i < fills; i++) random();
          fills += 3;
          array.input.value = Array.from(
            { length: 15 },
            () => 1 + Math.floor(random() * MAX_VALUE),
          ).join(' ');
        }),
      ),
      presetSelect(demo, [
        { name: 'Descending 15, bottom-up', ops: 'h15-14-13-12-11-10-9-8-7-6-5-4-3-2-1' },
        { name: 'Descending 15, by inserts', ops: 'n15-14-13-12-11-10-9-8-7-6-5-4-3-2-1' },
        { name: 'Build, then extract five', ops: 'h50-30-70-20-90-10-60-40-80-15-35-65.x.x.x.x.x' },
        { name: 'Ten inserts one at a time', ops: 'i42.i17.i68.i5.i91.i33.i12.i77.i3.i56' },
      ]),
    ),
    demo.player.root,
    demo.history,
  );

  demo.status.append(extracted);
  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-compare)', 'Compared'],
      ['var(--canvas-change)', 'Swapped'],
      ['var(--canvas-visit)', 'The other child'],
      ['var(--canvas-good)', 'Settled'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A binary heap is a complete binary tree in which every parent comes before its children: smaller in a min-heap, larger in a max-heap. Because the tree is complete it needs no pointers. It is stored level by level in an array, and the links are arithmetic on the index.',
    ),
    formula('parent(i) = (i − 1) / 2, rounded down\nchildren(i) = 2i + 1 and 2i + 2'),
    prose(
      'Insert puts the new value at the end and sifts it up: swap with the parent while it is out of order. Extract takes the root, moves the last item into its place and sifts it down: swap with the better child while it is out of order. Both follow one path, so they cost `O(log n)`.',
    ),
    prose(
      'Building a heap from an array can be done by `n` inserts, which costs `O(n log n)` in the worst case. The bottom-up method (Floyd) sifts down from the last parent back to the root. Most nodes are near the bottom and have little distance to fall, so the total is `O(n)`. Run both on the same descending array and compare the comparison counts.',
    ),
    formula(
      'bottom-up cost ≤ Σ over heights h of (n / 2^(h+1)) · h  <  n   swaps, at most 2n comparisons',
    ),
  );

  // A value worth trying first, so the first press of the button does something.
  const firstBox = demo.layout.panel.querySelector<HTMLInputElement>('fieldset.act input');
  if (firstBox) firstBox.value = '45';
  return demo.dispose;
};
