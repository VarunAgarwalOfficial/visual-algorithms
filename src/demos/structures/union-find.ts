import { layoutTree } from '../../core/structures/layout';
import { UnionFind, type UnionFindFrame, type UnionRule } from '../../core/structures/unionfind';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import {
  arrow,
  cellGrid,
  disc,
  drawCells,
  fitTree,
  label,
  roleStyle,
  type Gfx,
  type Point,
} from './draw';
import { actFieldset, opForm, opsDemo, presetSelect, record, refuse, wholeNumber } from './shared';

const MAX_N = 16;
const RULES: readonly { id: UnionRule; name: string }[] = [
  { id: 'rank', name: 'Union by rank' },
  { id: 'size', name: 'Union by size' },
  { id: 'none', name: 'No rule (first under second)' },
];

function clean(op: string): string | null {
  const union = /^u(\d{1,2})-(\d{1,2})$/.exec(op);
  if (union) {
    const a = Number(union[1]);
    const b = Number(union[2]);
    return a < MAX_N && b < MAX_N ? `u${a}-${b}` : null;
  }
  const find = /^f(\d{1,2})$/.exec(op);
  return find && Number(find[1]) < MAX_N ? `f${Number(find[1])}` : null;
}

export const mount: Mount = (root, entry) => {
  const url = urlState({
    n: 10,
    by: 'rank',
    pc: true,
    ops: 'u0-1.u2-3.u4-5.u6-7.u1-3.u5-7.u3-7.f0',
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  settings.n = Math.max(2, Math.min(MAX_N, Math.round(settings.n)));
  const rule = (): UnionRule => RULES.find((r) => r.id === settings.by)?.id ?? 'rank';

  const counters = stats({
    sets: 'Sets',
    tallest: 'Tallest tree',
    hops: 'Hops, this operation',
    total: 'Hops, total',
  });

  const demo = opsDemo<UnionFindFrame>({
    root,
    entry,
    canvasLabel:
      'The forest of sets above its parent array. Arrows point from each element to its parent.',
    settings,
    save: url.save,
    clean,
    describe: (op) =>
      op[0] === 'u' ? `union(${op.slice(1).replace('-', ', ')})` : `find(${op.slice(1)})`,
    run(ops) {
      const sets = new UnionFind(settings.n, rule(), settings.pc);
      return record(sets.frames, ops, (op) => {
        const [a, b] = op.slice(1).split('-').map(Number);
        if (a >= settings.n || (b ?? 0) >= settings.n) {
          refuse(
            sets.frames,
            `Skipped ${op[0] === 'u' ? 'union' : 'find'}: there are only elements 0 to ${settings.n - 1}.`,
          );
        } else if (op[0] === 'u') sets.union(a, b);
        else sets.find(a);
      });
    },
    draw,
    show(frame) {
      let tallest = 0;
      frame.parent.forEach((_, i) => {
        let depth = 0;
        for (let at = i; frame.parent[at] !== at; at = frame.parent[at]) depth++;
        tallest = Math.max(tallest, depth);
      });
      counters.set({ sets: frame.sets, tallest, hops: frame.hops, total: frame.totalHops });
    },
  });

  function draw(frame: UnionFindFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const n = frame.parent.length;
    const pad = Math.max(8, width * 0.025);
    const kids = new Map<number, number[]>();
    frame.parent.forEach((parent, i) => {
      const key = parent === i ? -1 : parent;
      kids.set(key, [...(kids.get(key) ?? []), i]);
    });
    // -1 is an invisible node above all the roots, so one layout places the whole forest.
    const layout = layoutTree<number, number>(-1, {
      id: (node) => node,
      children: (node) => kids.get(node) ?? [],
      gap: 0.35,
    });
    const probe = cellGrid(n, { x: pad, y: 0, w: width - 2 * pad, h: height * 0.24 }, 19, 32);
    const stripTop = height - pad - probe.height;
    const strip = cellGrid(
      n,
      { x: pad, y: stripTop, w: width - 2 * pad, h: height * 0.24 },
      19,
      32,
    );

    const box = { x: pad, y: pad, w: width - 2 * pad, h: stripTop - pad - 20 };
    const fit = fitTree({ ...layout, depth: layout.depth - 1 }, box, 46, 60);
    const levels = layout.depth - 1;
    const r = Math.max(3.5, Math.min(15, fit.unit * 0.42, levels > 1 ? fit.levelGap * 0.46 : 15));
    const px = Math.max(7.5, Math.min(13, r * 0.95));
    const at = new Map<number, Point>();
    for (let i = 0; i < n; i++) {
      const p = layout.at.get(i);
      if (p) at.set(i, g.place(i, fit.x(p.x), fit.y(p.depth - 1)));
    }
    for (let i = 0; i < n; i++) {
      const a = at.get(i);
      const b = at.get(frame.parent[i]);
      if (!a || !b || frame.parent[i] === i) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      const moved = frame.hi.get(i) === 'change';
      arrow(
        ctx,
        { x: a.x + ux * r, y: a.y + uy * r },
        { x: b.x - ux * (r + 1), y: b.y - uy * (r + 1) },
        moved ? palette.change : palette.muted,
        moved ? 2 : 1,
        Math.max(3, Math.min(5, r * 0.5)),
      );
    }
    for (let i = 0; i < n; i++) {
      const p = at.get(i);
      if (!p) continue;
      disc(ctx, p, r, {
        ...roleStyle(palette, frame.hi.get(i), px),
        text: r >= 4.5 ? String(i) : undefined,
      });
      if (frame.parent[i] === i && rule() !== 'none' && r >= 8) {
        label(ctx, `${rule()} ${frame.weight[i]}`, p.x, p.y - r - 7, palette.muted, 10);
      }
    }
    label(ctx, 'parent[i]', pad, stripTop - 9, palette.muted, 10, 'left');
    drawCells(
      g,
      frame.parent.map((parent, i) => ({
        text: String(parent),
        role: frame.hi.get(i),
        sub: String(i),
      })),
      strip,
    );
  }

  const pair = (text: string): number[] =>
    text
      .split(/[\s,;-]+/)
      .filter(Boolean)
      .map((part) => wholeNumber(part, 0, settings.n - 1) ?? -1);
  const randomPair = (random: () => number) => {
    const a = Math.floor(random() * settings.n);
    let b = Math.floor(random() * (settings.n - 1));
    if (b >= a) b++;
    return `u${a}-${b}`;
  };
  const size = slider({
    label: 'Elements',
    min: 2,
    max: MAX_N,
    value: settings.n,
    onInput(value) {
      settings.n = value;
      demo.rebuild();
    },
  });

  demo.layout.panel.append(
    actFieldset(
      'Operations',
      opForm({
        label: 'Elements: two for union, one for find',
        placeholder: '3 7',
        maxLength: 7,
        actions: [
          {
            name: 'Union',
            run: (text) => {
              const [a, b, extra] = pair(text);
              return a >= 0 && b >= 0 && extra === undefined && a !== b && demo.push(`u${a}-${b}`);
            },
          },
          {
            name: 'Find',
            run: (text) => {
              const [a, extra] = pair(text);
              return a >= 0 && extra === undefined && demo.push(`f${a}`);
            },
          },
        ],
      }).root,
    ),
    fieldset(
      'More operations',
      el(
        'div',
        { class: 'buttons' },
        button('5 random unions', () => {
          const random = demo.random();
          demo.push(...Array.from({ length: 5 }, () => randomPair(random)));
        }),
        button('Random operation', () => {
          const random = demo.random();
          demo.push(random() < 0.6 ? randomPair(random) : `f${Math.floor(random() * settings.n)}`);
        }),
      ),
      presetSelect(demo, [
        {
          name: 'Chain: union(0,1), union(1,2), … then find(0)',
          ops: `${Array.from({ length: 9 }, (_, i) => `u${i}-${i + 1}`).join('.')}.f0.f0`,
        },
        { name: 'Pairs, then pairs of pairs', ops: 'u0-1.u2-3.u4-5.u6-7.u1-3.u5-7.u3-7.f0' },
        {
          name: 'Star: everything joins 0',
          ops: Array.from({ length: 9 }, (_, i) => `u${i + 1}-0`).join('.'),
        },
      ]),
    ),
    fieldset(
      'Rules',
      size.root,
      select<UnionRule>({
        label: 'Linking',
        options: RULES,
        value: rule(),
        onChange(id) {
          settings.by = id;
          demo.rebuild();
        },
      }).root,
      checkbox({
        label: 'Path compression',
        checked: settings.pc,
        onChange(on) {
          settings.pc = on;
          demo.rebuild();
        },
      }),
    ),
    demo.player.root,
    demo.history,
  );

  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-visit)', 'On the path'],
      ['var(--canvas-compare)', 'Stepped to'],
      ['var(--canvas-good)', 'Root'],
      ['var(--canvas-change)', 'Re-pointed'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A disjoint-set structure keeps elements in groups and answers one question: are these two in the same group? Each group is a tree of parent pointers and its root is the name of the group. `find(x)` follows parents up to the root. `union(a, b)` finds both roots and points one at the other. The whole structure is one array, `parent`.',
    ),
    prose(
      'Left alone, the trees can grow into long chains and every find walks the chain. Two fixes keep them flat. Union by rank (or by size) always hangs the shorter (or smaller) tree under the other, which alone keeps the height at most `log2 n`. Path compression makes every node passed during a find point straight at the root, so the next find is one hop.',
    ),
    prose(
      'Load the chain preset, then turn the linking rule and path compression off and on. The operations are replayed under the new rules; watch the tallest tree and the hop count.',
    ),
    formula(
      'no rule:                    O(n) per find in the worst case\nby rank or size:            O(log n)\nwith path compression too:  O(α(n)) amortised, where α(n) ≤ 4 for any n that fits in the universe',
    ),
  );

  // A value worth trying first, so the first press of the button does something.
  const firstBox = demo.layout.panel.querySelector<HTMLInputElement>('fieldset.act input');
  if (firstBox) firstBox.value = '7 8';
  return demo.dispose;
};
