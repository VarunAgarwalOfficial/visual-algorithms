import { shuffle } from '../../core/random';
import {
  SearchTree,
  type TreeFrame,
  type TreeSnap,
  type TreeVariant,
} from '../../core/structures/bst';
import { layoutTree } from '../../core/structures/layout';
import { el, fieldset, select } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import { contrast, disc, fitTree, label, line, roleColour, roleStyle, type Gfx } from './draw';
import { keyOpCodec, keyOpsFieldset, opsDemo, presetSelect, record, refuse } from './shared';

const MAX_KEY = 99;
const MAX_NODES = 31;
const VARIANTS: readonly { id: TreeVariant; name: string }[] = [
  { id: 'bst', name: 'Plain (no balancing)' },
  { id: 'avl', name: 'AVL (rebalances with rotations)' },
  { id: 'rb', name: 'Red-black (rebalances using node colours)' },
];
const SHORT: Record<TreeVariant, string> = { bst: 'Plain', avl: 'AVL', rb: 'Red-black' };

function apply(tree: SearchTree, op: string) {
  const key = Number(op.slice(1));
  if (op[0] === 'd') tree.delete(key);
  else if (op[0] === 'f') tree.find(key);
  else if (tree.size >= MAX_NODES && !tree.has(key)) {
    refuse(
      tree.frames,
      `This demo stops at ${MAX_NODES} keys so the tree stays readable. Delete one first.`,
    );
  } else tree.insert(key);
}

export const mount: Mount = (root, entry) => {
  const url = urlState({
    kind: 'avl',
    ops: 'i40.i20.i60.i10.i30.i50.i70.i25.i35.i33',
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  const variant = (): TreeVariant => VARIANTS.find((v) => v.id === settings.kind)?.id ?? 'avl';
  const codec = keyOpCodec(MAX_KEY);
  let keys: number[] = [];

  const counters = stats({
    size: 'Keys',
    height: 'Levels (height)',
    rotations: 'Rotations',
    comparisons: 'Comparisons',
  });
  const compare = el('p', { class: 'note' });

  const demo = opsDemo<TreeFrame>({
    root,
    entry,
    canvasLabel: 'The search tree. Nodes being compared or moved are highlighted.',
    settings,
    save: url.save,
    ...codec,
    run(ops) {
      const tree = new SearchTree(variant());
      const recording = record(tree.frames, ops, (op) => apply(tree, op));
      keys = tree.inorder();
      const others = VARIANTS.map(({ id }) => {
        const other = id === tree.variant ? tree : new SearchTree(id);
        if (other !== tree) for (const op of ops) apply(other, op);
        return `${SHORT[id]}: height ${other.height}, ${other.rotations} rotation${other.rotations === 1 ? '' : 's'}`;
      });
      compare.textContent = `After all ${ops.length} operations. ${others.join('. ')}.`;
      return recording;
    },
    draw,
    intro() {
      const next = keyBox()?.value;
      const kind = variant();
      const what =
        kind === 'avl' ? 'This AVL tree' : kind === 'rb' ? 'This red-black tree' : 'This tree';
      const shape =
        kind === 'avl'
          ? ' The small number beside each node is its balance: levels on its left minus levels on its right.'
          : kind === 'rb'
            ? ' Each node is red or black; those colours are what keep it balanced.'
            : '';
      return `Nothing has run yet. ${what} already holds ${keys.length} keys. At every node, smaller keys sit down the left and larger keys down the right.${shape}${
        next ? ` Press Insert to add ${next} and watch it find its place.` : ''
      }`;
    },
    show(frame) {
      counters.set({
        size: frame.size,
        height: frame.height,
        rotations: frame.rotations,
        comparisons: frame.comparisons,
      });
    },
  });

  function draw(frame: TreeFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const kind = variant();
    const pad = Math.max(8, width * 0.025);
    const top = 22;
    if (frame.rule) label(ctx, frame.rule, pad, 13, palette.ink, 12, 'left', true);
    if (!frame.root) {
      label(ctx, 'Empty tree. Insert a key.', width / 2, height / 2, palette.muted, 13);
      return;
    }
    const layout = layoutTree<TreeSnap, number>(frame.root, {
      id: (node) => node.id,
      children: (node) => [node.left, node.right],
      gap: 0.2,
      hole: 0.5,
    });
    const fit = fitTree(
      layout,
      { x: pad, y: top, w: width - 2 * pad, h: height - top - pad - (kind === 'avl' ? 16 : 0) },
      60,
      72,
    );
    const squeeze = layout.depth > 1 ? fit.levelGap * 0.5 : 20;
    const r = Math.max(3.5, Math.min(20, fit.unit * 0.46 > 6.5 ? fit.unit * 0.46 : 6.5, squeeze));
    const px = Math.max(7.5, Math.min(14, r * 0.95));
    const at = new Map<number, { x: number; y: number }>();
    const visit = (node: TreeSnap | null, each: (node: TreeSnap) => void) => {
      if (!node) return;
      each(node);
      visit(node.left, each);
      visit(node.right, each);
    };
    visit(frame.root, (node) => {
      const p = layout.at.get(node.id);
      if (p) at.set(node.id, g.place(node.id, fit.x(p.x), fit.y(p.depth)));
    });
    visit(frame.root, (node) => {
      const a = at.get(node.id);
      for (const kid of [node.left, node.right]) {
        const b = kid && at.get(kid.id);
        if (a && b) line(ctx, a, b, palette.muted);
      }
    });
    visit(frame.root, (node) => {
      const p = at.get(node.id);
      if (!p) return;
      const role = frame.hi.get(node.id);
      const text = r >= 4.5 ? String(node.key) : undefined;
      if (kind === 'rb') {
        const fill = node.red ? palette.change : palette.ink;
        const ring = roleColour(palette, role);
        if (ring) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = role === 'change' ? palette.accent : ring;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        disc(ctx, p, r, {
          fill,
          stroke: fill,
          text,
          textColour: contrast(palette, fill),
          fontPx: px,
          bold: true,
        });
      } else {
        disc(ctx, p, r, { ...roleStyle(palette, role, px), text });
      }
      if (kind === 'avl' && r >= 9) {
        const b = node.balance;
        const sign = b > 0 ? `+${b}` : b < 0 ? `−${-b}` : '0';
        // The label sits just under the node, between the edges to its children.
        label(
          ctx,
          sign,
          p.x,
          p.y + r + Math.max(7, px - 2),
          Math.abs(b) > 1 ? palette.change : palette.muted,
          Math.max(9, px - 3),
          'center',
          Math.abs(b) > 1,
        );
      }
    });
  }

  const keyOps = keyOpsFieldset(demo, { maxKey: MAX_KEY, keys: () => keys, maxKeys: MAX_NODES });

  /** The key box under the picture, which holds the suggested next key. */
  function keyBox() {
    return root.querySelector<HTMLInputElement>('fieldset.act input');
  }

  const key = el('ul', { class: 'legend' });
  function showKey() {
    const kind = variant();
    const items: [string, string][] = [['var(--canvas-compare)', 'Being compared with the key']];
    if (kind === 'rb') {
      items.push(
        ['var(--canvas-change)', 'Red node'],
        ['var(--canvas-ink)', 'Black node'],
        ['var(--canvas-accent)', 'Ring: just recoloured or moved'],
      );
    } else {
      items.push(['var(--canvas-change)', kind === 'avl' ? 'Moved by a rotation' : 'Moved']);
    }
    items.push(['var(--canvas-good)', 'Found']);
    key.replaceChildren(...legend(items).children);
  }
  showKey();

  demo.layout.panel.append(
    fieldset(
      'Tree',
      select<TreeVariant>({
        label: 'Kind of tree',
        options: VARIANTS,
        value: variant(),
        onChange(id) {
          settings.kind = id;
          demo.rebuild();
          showKey();
        },
      }).root,
      presetSelect(demo, [
        {
          name: 'Sorted input, 1 to 12',
          ops: Array.from({ length: 12 }, (_, i) => `i${i + 1}`).join('.'),
        },
        {
          name: 'Zigzag input',
          ops: [1, 12, 2, 11, 3, 10, 4, 9, 5, 8, 6, 7].map((k) => `i${k}`).join('.'),
        },
        {
          name: '15 random keys',
          ops: () =>
            shuffle(
              Array.from({ length: MAX_KEY }, (_, i) => i + 1),
              demo.random(),
            )
              .slice(0, 15)
              .map((k) => `i${k}`)
              .join('.'),
        },
        {
          name: 'Inserts, then deletes',
          ops: 'i50.i30.i70.i20.i40.i60.i80.i10.i25.i35.i45.i65.d10.d25.d20.d50.d70',
        },
      ]),
    ),
    keyOps,
    demo.player.root,
    demo.history,
  );

  demo.layout.readout.append(
    counters.root,
    demo.status,
    key,
    el('details', {}, el('summary', { text: 'Compare the three kinds of tree' }), compare),
  );
  demo.refresh();

  demo.layout.about.append(
    prose(
      'A binary search tree keeps smaller keys to the left of each node and larger keys to the right, so a search follows one path down. The cost of every operation is the height of the tree. A plain tree has no control over its height: feed it sorted keys and it becomes a list.',
    ),
    prose(
      'An AVL tree stores a balance factor at each node, the height of the left subtree minus the right. After an insert or delete it walks back up and, where the factor reaches `±2`, fixes it with one or two rotations. A rotation lifts a child above its parent without breaking the left-to-right order. The four cases are named after where the extra height sits: left-left, left-right, right-left, right-right.',
    ),
    prose(
      'A red-black tree is looser. Each node is red or black; the root is black, a red node has no red child, and every path from the root to an empty place passes the same number of black nodes. Those rules keep the longest path at most twice the shortest. Inserting adds a red node and repairs any red-red pair; deleting a black node leaves one path short and repairs that. The case being applied is shown at the top left of the canvas.',
    ),
    formula(
      'plain tree   height between log2(n) and n\nAVL          height ≤ 1.44 log2(n + 2)      at most 2 rotations per insert\nred-black    height ≤ 2 log2(n + 1)         at most 2 per insert, 3 per delete\nsearch, insert, delete: O(height)',
    ),
    prose(
      'Switch the kind to replay the same operations on another tree, and compare the heights and rotation counts under the canvas.',
    ),
  );

  return demo.dispose;
};
