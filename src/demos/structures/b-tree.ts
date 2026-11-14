import { shuffle } from '../../core/random';
import { BTree, type BTreeFrame, type BTreeSnap } from '../../core/structures/btree';
import { layoutTree } from '../../core/structures/layout';
import { fieldset, select } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import {
  fitTree,
  label,
  line,
  plate,
  roleColour,
  roleStyle,
  tint,
  type Gfx,
  type Point,
} from './draw';
import { keyOpCodec, keyOpsFieldset, opsDemo, presetSelect, record, refuse } from './shared';

const MAX_KEY = 99;
const MAX_KEYS = 28;
const DEGREES = [
  { id: '2', name: 't = 2 (1 to 3 keys, a 2-3-4 tree)' },
  { id: '3', name: 't = 3 (2 to 5 keys)' },
  { id: '4', name: 't = 4 (3 to 7 keys)' },
] as const;

export const mount: Mount = (root, entry) => {
  const url = urlState({
    t: 2,
    ops: 'i10.i20.i30.i40.i50.i60.i70.i80.i90.i25.i35',
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  settings.t = Math.max(2, Math.min(4, Math.round(settings.t)));
  const codec = keyOpCodec(MAX_KEY, 'search for');
  let keys: number[] = [];

  const counters = stats({ size: 'Keys', height: 'Height', splits: 'Splits', merges: 'Merges' });

  const demo = opsDemo<BTreeFrame>({
    root,
    entry,
    canvasLabel: 'The B-tree. Each box is a node holding several keys in order.',
    settings,
    save: url.save,
    ...codec,
    run(ops) {
      const tree = new BTree(settings.t);
      const recording = record(tree.frames, ops, (op) => {
        const key = Number(op.slice(1));
        if (op[0] === 'd') tree.delete(key);
        else if (op[0] === 'f') tree.find(key);
        else if (tree.size >= MAX_KEYS && !tree.has(key)) {
          refuse(
            tree.frames,
            `This demo stops at ${MAX_KEYS} keys so the nodes stay readable. Delete one first.`,
          );
        } else tree.insert(key);
      });
      keys = tree.inorder();
      return recording;
    },
    draw,
    show(frame) {
      counters.set({
        size: frame.size,
        height: frame.height,
        splits: frame.splits,
        merges: frame.merges,
      });
    },
  });

  function draw(frame: BTreeFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const pad = Math.max(8, width * 0.025);
    const span = (node: BTreeSnap) => Math.max(1, node.keys.length);
    const layout = layoutTree<BTreeSnap, number>(frame.root, {
      id: (node) => node.id,
      children: (node) => node.kids,
      width: span,
      gap: 0.45,
    });
    const fit = fitTree(
      layout,
      { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad },
      38,
      90,
    );
    const cell = fit.unit;
    const h = Math.max(14, Math.min(28, cell * 0.9));
    const px = Math.max(7.5, Math.min(13, cell * 0.5));
    const at = new Map<number, Point>();
    const visit = (node: BTreeSnap, each: (node: BTreeSnap) => void) => {
      each(node);
      node.kids.forEach((kid) => visit(kid, each));
    };
    visit(frame.root, (node) => {
      const p = layout.at.get(node.id);
      if (p) at.set(node.id, g.place(node.id, fit.x(p.x), fit.y(p.depth)));
    });
    visit(frame.root, (node) => {
      const a = at.get(node.id);
      if (!a) return;
      const left = a.x - (span(node) * cell) / 2;
      node.kids.forEach((kid, i) => {
        const b = at.get(kid.id);
        // Child i hangs from the boundary before key i.
        if (b)
          line(
            ctx,
            { x: left + i * cell, y: a.y + h / 2 },
            { x: b.x, y: b.y - h / 2 },
            palette.muted,
          );
      });
    });
    visit(frame.root, (node) => {
      const p = at.get(node.id);
      if (!p) return;
      const role = frame.hi.get(node.id);
      const w = span(node) * cell;
      const overfull = node.keys.length > 2 * settings.t - 1;
      const style = roleStyle(palette, overfull ? 'change' : role, px);
      plate(ctx, p, w, h, style);
      const left = p.x - w / 2;
      node.keys.forEach((key, i) => {
        const x = left + (i + 0.5) * cell;
        if (role && frame.keys.includes(key)) {
          ctx.fillStyle = tint(
            palette,
            roleColour(palette, role === 'visit' ? 'compare' : role) ?? palette.accent,
            0.75,
          );
          ctx.fillRect(left + i * cell + 2, p.y - h / 2 + 2, cell - 4, h - 4);
        }
        if (i > 0) {
          line(
            ctx,
            { x: left + i * cell, y: p.y - h / 2 + 3 },
            { x: left + i * cell, y: p.y + h / 2 - 3 },
            palette.faint,
          );
        }
        label(ctx, String(key), x, p.y + 0.5, palette.ink, px);
      });
      if (node.keys.length === 0) label(ctx, 'empty', p.x, p.y + h, palette.muted, 11);
    });
  }

  demo.layout.panel.append(
    fieldset(
      'Tree',
      select({
        label: 'Minimum degree',
        options: DEGREES,
        value: String(settings.t) as '2' | '3' | '4',
        onChange(id) {
          settings.t = Number(id);
          demo.rebuild();
        },
      }).root,
      presetSelect(demo, [
        {
          name: 'Sorted input, 20 keys',
          ops: Array.from({ length: 20 }, (_, i) => `i${(i + 1) * 4}`).join('.'),
        },
        {
          name: '20 random keys',
          ops: () =>
            shuffle(
              Array.from({ length: MAX_KEY }, (_, i) => i + 1),
              demo.random(),
            )
              .slice(0, 20)
              .map((k) => `i${k}`)
              .join('.'),
        },
        {
          name: 'Inserts, then deletes that borrow and merge',
          ops: 'i10.i20.i30.i40.i50.i60.i70.i80.i90.i25.i35.d90.d80.d20.d40.d10.d50',
        },
      ]),
    ),
    keyOpsFieldset(demo, {
      maxKey: MAX_KEY,
      keys: () => keys,
      maxKeys: MAX_KEYS,
      findName: 'Search',
    }),
    demo.player.root,
    demo.history,
  );

  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-compare)', 'Being read'],
      ['var(--canvas-change)', 'Changed, or overfull'],
      ['var(--canvas-good)', 'Found, or received a key'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A B-tree is a search tree with wide nodes. With minimum degree `t`, every node except the root holds between `t − 1` and `2t − 1` keys, and a node with `k` keys has `k + 1` children. All leaves are at the same depth. Wide nodes make the tree shallow, which is why databases and file systems use it: one node is one disk block.',
    ),
    prose(
      'An insert always goes into a leaf. If that leaves the node with one key too many, the node splits around its median: the median moves up into the parent and the two halves become separate children. The parent may overflow in turn. When the root splits a new root appears above it, so the tree grows at the top and the leaves stay level.',
    ),
    prose(
      'A delete works on the way down. Before entering a child that is at the minimum, it borrows a key from a sibling through the parent, or merges the child with a sibling and the key between them. A key in an internal node is replaced by its predecessor or successor from a leaf. When a merge empties the root, the tree loses a level.',
    ),
    formula(
      'height ≤ log_t((n + 1) / 2) + 1\nsearch, insert, delete: O(t · log_t n) key comparisons, O(log_t n) nodes read',
    ),
  );

  return demo.dispose;
};
