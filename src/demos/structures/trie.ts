import { layoutTree } from '../../core/structures/layout';
import { compress, Trie, type TrieFrame, type TrieSnap } from '../../core/structures/trie';
import { button, checkbox, el, fieldset } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import { fitTree, label, line, plate, roleStyle, type Gfx, type Point } from './draw';
import { actFieldset, opForm, opsDemo, presetSelect, record, refuse } from './shared';

const MAX_LENGTH = 8;
const MAX_NODES = 64;
const POOL =
  'tea team ten tent to top tap tape ant and any art arm car card care cat cut cup dog do dot day in inn ink sea see seed sun'.split(
    ' ',
  );

const word = (text: string) => (/^[a-z]{1,8}$/.test(text) ? text : null);
const list = (words: string) =>
  words
    .split(' ')
    .map((w) => `i${w}`)
    .join('.');

export const mount: Mount = (root, entry) => {
  const url = urlState({
    radix: false,
    ops: list('tea team ten to car card care cat in inn'),
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  let words: string[] = [];

  const counters = stats({ nodes: 'Nodes', words: 'Words' });
  const completions = el('p', { class: 'note' });

  const demo = opsDemo<TrieFrame>({
    root,
    entry,
    canvasLabel: 'The trie. Each edge down adds one letter; ringed nodes end a word.',
    settings,
    save: url.save,
    clean(op) {
      const text = word(op.slice(1));
      return text && 'idp'.includes(op[0]) ? `${op[0]}${text}` : null;
    },
    describe(op) {
      const what = op[0] === 'i' ? 'insert' : op[0] === 'd' ? 'delete' : 'words starting with';
      return `${what} "${op.slice(1)}"`;
    },
    run(ops) {
      const trie = new Trie();
      const recording = record(trie.frames, ops, (op) => {
        const text = op.slice(1);
        if (op[0] === 'd') trie.delete(text);
        else if (op[0] === 'p') trie.complete(text);
        else if (trie.nodes + text.length > MAX_NODES && !trie.has(text)) {
          refuse(
            trie.frames,
            `This demo stops at ${MAX_NODES} nodes so the letters stay readable. Delete a word first.`,
          );
        } else trie.insert(text);
      });
      words = trie.list();
      return recording;
    },
    draw,
    show(frame) {
      counters.set({ nodes: frame.nodes, words: frame.words });
      completions.textContent =
        frame.completions === null
          ? `Stored: ${words.length === 0 ? 'nothing' : words.join(', ')}.`
          : `Completions so far: ${frame.completions.length === 0 ? 'none' : frame.completions.join(', ')}.`;
    },
  });

  function draw(frame: TrieFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const view = settings.radix
      ? compress(frame.root, frame.hi)
      : { root: frame.root, hi: frame.hi };
    const pad = Math.max(8, width * 0.025);
    const span = (node: TrieSnap) => Math.max(1, 0.5 + node.label.length * 0.55);
    const layout = layoutTree<TrieSnap, number>(view.root, {
      id: (node) => node.id,
      children: (node) => node.kids,
      width: span,
      gap: 0.25,
    });
    const fit = fitTree(
      layout,
      { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad },
      40,
      62,
    );
    const size = Math.max(
      11,
      Math.min(26, fit.unit * 0.88, fit.levelGap > 0 ? fit.levelGap * 0.72 : 26),
    );
    const px = Math.max(8.5, Math.min(14, size * 0.6));
    const at = new Map<number, Point>();
    const visit = (node: TrieSnap, each: (node: TrieSnap) => void) => {
      each(node);
      node.kids.forEach((kid) => visit(kid, each));
    };
    visit(view.root, (node) => {
      const p = layout.at.get(node.id);
      if (p) at.set(node.id, g.place(node.id, fit.x(p.x), fit.y(p.depth)));
    });
    visit(view.root, (node) => {
      const a = at.get(node.id);
      for (const kid of node.kids) {
        const b = at.get(kid.id);
        if (a && b) line(ctx, a, b, palette.muted);
      }
    });
    visit(view.root, (node) => {
      const p = at.get(node.id);
      if (!p) return;
      const role = view.hi.get(node.id);
      const w = Math.max(size, (span(node) - 0.12) * fit.unit * (node.label.length > 1 ? 1 : 0));
      const style = roleStyle(palette, role, px);
      if (node.label === '') {
        plate(ctx, p, size * 0.7, size * 0.7, {
          ...style,
          fill: role ? style.fill : palette.faint,
        });
        return;
      }
      if (node.end) {
        // Word endings carry a second outline.
        plate(ctx, p, w + 6, size + 6, {
          fill: palette.bg,
          stroke: palette.accent,
          lineWidth: 1.5,
          textColour: palette.ink,
          fontPx: px,
        });
      }
      plate(ctx, p, w, size, { ...style, text: node.label, bold: node.end });
    });
    if (frame.words === 0 && frame.nodes === 1) {
      label(ctx, 'Empty trie. Insert a word.', width / 2, height / 2, palette.muted, 13);
    }
  }

  const act = (code: string) => (text: string) => {
    const clean = word(text.toLowerCase());
    return clean !== null && demo.push(`${code}${clean}`);
  };

  demo.layout.panel.append(
    actFieldset(
      'Operations',
      opForm({
        label: `Word or prefix (a to z, up to ${MAX_LENGTH} letters)`,
        maxLength: MAX_LENGTH,
        actions: [
          { name: 'Insert', run: act('i') },
          { name: 'Delete', run: act('d') },
          { name: 'Complete prefix', run: act('p') },
        ],
      }).root,
    ),
    fieldset(
      'More operations',
      el(
        'div',
        { class: 'buttons' },
        button('Random operation', () => {
          const random = demo.random();
          const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
          const roll = random();
          const unused = POOL.filter((w) => !words.includes(w));
          if (words.length === 0 || (roll < 0.5 && unused.length > 0))
            demo.push(`i${pick(unused)}`);
          else if (roll < 0.7) demo.push(`d${pick(words)}`);
          else demo.push(`p${pick(words).slice(0, 1 + Math.floor(random() * 2))}`);
        }),
      ),
      presetSelect(
        demo,
        [
          {
            name: 'Shared prefixes, then complete "te"',
            ops: `${list('tea team ten tent to top tap tape')}.pte`,
          },
          { name: 'Words inside words', ops: `${list('in inn ink do dog dot dots')}.pdo.ddot.pdo` },
          { name: 'No shared letters', ops: list('ant cup dog sea') },
          { name: 'Insert, then delete back to nothing', ops: 'icar.icard.icare.dcard.dcare.dcar' },
        ],
        'Word list',
      ),
    ),
    fieldset(
      'View',
      checkbox({
        label: 'Compressed (radix) view',
        checked: settings.radix,
        onChange(on) {
          settings.radix = on;
          url.save();
          demo.redraw();
        },
      }),
    ),
    demo.player.root,
    demo.history,
  );

  demo.status.append(completions);
  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-compare)', 'Letter being followed'],
      ['var(--canvas-visit)', 'Path so far'],
      ['var(--canvas-change)', 'Added or changed'],
      ['var(--canvas-good)', 'A stored word'],
      ['var(--canvas-accent)', 'Double outline: a word ends here'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A trie stores words by their letters. The root stands for the empty string and each edge down adds one letter, so every node stands for a prefix. A flag marks the nodes where a stored word ends. Words with a common prefix share the nodes of that prefix.',
    ),
    prose(
      'Looking up a word follows one edge per letter. The cost depends on the length of the word, not on how many words are stored. Every word that starts with a prefix lives in the subtree under that prefix, which is what makes completion cheap: walk to the prefix, then list the subtree.',
    ),
    prose(
      'Deleting clears the end flag, then removes nodes from the bottom up while they have no children and end no word. The compressed view joins each chain of single-child nodes into one node with a longer label. That is a radix tree: the same words in fewer nodes.',
    ),
    formula(
      'insert, lookup, delete: O(length of the word)\ncompletions of a prefix: O(length of the prefix + size of its subtree)',
    ),
  );

  // A value worth trying first, so the first press of the button does something.
  const firstBox = demo.layout.panel.querySelector<HTMLInputElement>('fieldset.act input');
  if (firstBox) firstBox.value = 'tent';
  return demo.dispose;
};
