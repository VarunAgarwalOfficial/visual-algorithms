import { newSeed, seeded } from '../../core/random';
import { SKIP_MAX_LEVEL, SkipList, type SkipFrame } from '../../core/structures/skiplist';
import { button, el } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import { arrow, disc, label, roleColour, roleStyle, type Gfx } from './draw';
import { keyOpCodec, keyOpsFieldset, opsDemo, presetSelect, record, refuse } from './shared';

const MAX_KEY = 99;
const MAX_KEYS = 18;

export const mount: Mount = (root, entry) => {
  const url = urlState({
    ops: 'i30.i10.i50.i20.i40.i60.i25.i45.i15.i55.f45',
    seed: 4,
    speed: 3,
  });
  const settings = url.state;
  const codec = keyOpCodec(MAX_KEY);
  let keys: number[] = [];

  const counters = stats({ size: 'Keys', levels: 'Levels in use', comparisons: 'Comparisons' });
  const towers = el('p', { class: 'note' });

  const demo = opsDemo<SkipFrame>({
    root,
    entry,
    canvasLabel: 'The skip list: one tower per key, with a linked list on every level.',
    settings,
    save: url.save,
    ...codec,
    run(ops) {
      const list = new SkipList(seeded(settings.seed));
      const recording = record(list.frames, ops, (op) => {
        const key = Number(op.slice(1));
        if (op[0] === 'd') list.delete(key);
        else if (op[0] === 'f') list.find(key);
        else if (list.size >= MAX_KEYS && !list.has(key)) {
          refuse(
            list.frames,
            `This demo stops at ${MAX_KEYS} keys so the towers stay readable. Delete one first.`,
          );
        } else list.insert(key);
      });
      keys = list.keys();
      return recording;
    },
    draw,
    show(frame) {
      counters.set({ size: frame.size, levels: frame.levels, comparisons: frame.comparisons });
      const counts = new Array<number>(SKIP_MAX_LEVEL).fill(0);
      for (const node of frame.nodes.slice(1)) counts[node.next.length - 1]++;
      const parts = counts
        .map((count, i) => (count > 0 ? `${count} of height ${i + 1}` : ''))
        .filter(Boolean);
      towers.textContent =
        parts.length === 0
          ? 'No towers yet.'
          : `Towers: ${parts.join(', ')}. About half as many are expected at each height up.`;
    },
  });

  function draw(frame: SkipFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const pad = Math.max(8, width * 0.025);
    const columns = frame.nodes.length + 1; // the towers, then the end marker
    const col = (width - 2 * pad) / columns;
    const coins = 26;
    const keyRow = 18;
    const row = Math.min(46, (height - 2 * pad - coins - keyRow) / SKIP_MAX_LEVEL);
    const box = Math.max(7, Math.min(26, col * 0.62, row * 0.7));
    const base = Math.min(
      height - pad - keyRow,
      pad + coins + (height - 2 * pad - coins - keyRow + SKIP_MAX_LEVEL * row) / 2,
    );
    const y = (level: number) => base - (level + 0.5) * row;
    const px = Math.max(8, Math.min(12, col * 0.5));
    const endX = pad + (columns - 0.5) * col;

    // Coin flips for the tower being inserted.
    if (frame.flips) {
      const r = 8;
      label(ctx, 'Coin flips', pad, pad + r, palette.muted, 11, 'left');
      frame.flips.forEach((heads, i) => {
        disc(ctx, { x: pad + 72 + i * (2 * r + 5), y: pad + r }, r, {
          fill: heads ? palette.accent : palette.bg,
          stroke: heads ? palette.accent : palette.muted,
          text: heads ? 'H' : 'T',
          textColour: heads ? palette.bg : palette.ink,
          fontPx: 10,
          bold: true,
        });
      });
    }

    const x = new Map<number, number>();
    frame.nodes.forEach((node, i) => {
      x.set(node.id, g.place(node.id, pad + (i + 0.5) * col, 0).x);
    });
    for (let level = 0; level < SKIP_MAX_LEVEL; level++) {
      label(
        ctx,
        `L${level + 1}`,
        endX,
        y(level),
        level < frame.levels ? palette.muted : palette.faint,
        10,
      );
    }
    label(ctx, 'end', endX, base + keyRow / 2, palette.muted, 10);

    // Pointers first, towers on top.
    for (const node of frame.nodes) {
      const from = x.get(node.id) ?? 0;
      node.next.forEach((next, level) => {
        if (next === undefined) return;
        if (node.id === 0 && level >= frame.levels) return;
        const to = next === null ? endX - 10 : (x.get(next) ?? endX) - box / 2 - 1;
        const role = frame.hi.get(`${node.id}:${level}`);
        const colour =
          role === 'compare' || role === 'change' ? roleColour(palette, role) : undefined;
        if (to > from + box / 2 + 2) {
          arrow(
            ctx,
            { x: from + box / 2, y: y(level) },
            { x: to, y: y(level) },
            colour ?? palette.muted,
            colour ? 2 : 1,
            Math.max(3, Math.min(5, box * 0.3)),
          );
        }
      });
    }
    for (const node of frame.nodes) {
      const cx = x.get(node.id) ?? 0;
      const tall = node.id === 0 ? frame.levels : node.next.length;
      for (let level = 0; level < tall; level++) {
        const style = roleStyle(palette, frame.hi.get(`${node.id}:${level}`), px);
        ctx.fillStyle = style.fill;
        ctx.fillRect(cx - box / 2, y(level) - box / 2, box, box);
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.lineWidth ?? 1;
        ctx.strokeRect(cx - box / 2, y(level) - box / 2, box, box);
        if (level > 0) {
          ctx.strokeStyle = palette.muted;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, y(level) + box / 2);
          ctx.lineTo(cx, y(level - 1) - box / 2);
          ctx.stroke();
        }
      }
      label(
        ctx,
        node.id === 0 ? 'head' : String(node.key),
        cx,
        base + keyRow / 2,
        node.id === 0 ? palette.muted : palette.ink,
        node.id === 0 ? Math.min(10, px) : px,
        'center',
        node.id !== 0,
      );
    }
  }

  demo.layout.panel.append(
    keyOpsFieldset(
      demo,
      { maxKey: MAX_KEY, keys: () => keys, maxKeys: MAX_KEYS },
      presetSelect(demo, [
        { name: 'Ten keys, then a search', ops: 'i30.i10.i50.i20.i40.i60.i25.i45.i15.i55.f45' },
        {
          name: 'Sorted input',
          ops: `${Array.from({ length: 12 }, (_, i) => `i${(i + 1) * 5}`).join('.')}.f60`,
        },
        { name: 'Insert, search, delete', ops: 'i20.i40.i60.i80.i50.f50.d50.f50.d20' },
      ]),
      el(
        'div',
        { class: 'buttons' },
        button('New coin flips', () => {
          settings.seed = newSeed();
          demo.rebuild();
        }),
      ),
    ),
    demo.player.root,
    demo.history,
  );

  demo.status.append(towers);
  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-compare)', 'Pointer being looked along'],
      ['var(--canvas-visit)', 'Search path so far'],
      ['var(--canvas-change)', 'Pointer rewritten'],
      ['var(--canvas-good)', 'Found'],
      ['var(--canvas-accent)', 'Heads'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A skip list is a sorted linked list with express lanes. Every key is on level 1. Each key is also on level 2 with probability one half, on level 3 with probability one quarter, and so on: its tower height is the number of coin flips up to the first tails. Each level is a linked list of the towers that reach it.',
    ),
    prose(
      'A search starts at the top of the head tower. On each level it moves right while the next key is smaller than the target, then drops down a level. The upper levels skip over many keys at once, so the path looks like a staircase. Insert runs the same search, remembers the last tower visited on each level, flips coins for the height and splices the new tower in after those. Delete unlinks the tower on each of its levels.',
    ),
    formula(
      'P(height ≥ k) = (1/2)^(k − 1)        expected towers on level k: n / 2^(k − 1)\nexpected levels ≈ log2 n             expected search cost ≈ 2 log2 n comparisons\nexpected pointers per key: 2',
    ),
    prose(
      'No rebalancing is ever needed: the balance comes from the coin flips, not from the order of the keys. Sorted input, the worst case for a plain search tree, is no problem here. The cost is that the bounds hold on average and with high probability, not for certain. "New coin flips" replays the same operations with a different seed.',
    ),
  );

  return demo.dispose;
};
