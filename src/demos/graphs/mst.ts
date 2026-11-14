import { allPairs, gabrielPairs, lengthWeight, scatter, type Graph } from '../../core/graphs/graph';
import { kruskal, prim, type MstFrame } from '../../core/graphs/mst';
import type { Random } from '../../core/random';
import { select } from '../../ui/dom';
import { formula, prose, type Mount } from '../layout';
import { drawGraph, tint } from './graphview';
import { graphLab } from './lab';

const ALGORITHMS = [
  { id: 'kruskal', name: "Kruskal's algorithm" },
  { id: 'prim', name: "Prim's algorithm" },
] as const;
const PRESETS = [
  { id: 'random', name: 'Random points' },
  { id: 'clusters', name: 'Three clusters' },
  { id: 'circle', name: 'Circle' },
] as const;
const EDGE_SETS = [
  { id: 'near', name: 'Nearby pairs (Gabriel graph)' },
  { id: 'all', name: 'All pairs' },
] as const;
const WEIGHTS = [
  { id: 'length', name: 'Length on screen' },
  { id: 'random', name: 'Random' },
] as const;

function preset(id: string, random: Random): Graph {
  if (id === 'circle') {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      x: 0.5 + 0.46 * Math.cos((i / 12) * 2 * Math.PI + 0.2 * random()),
      y: 0.5 + 0.46 * Math.sin((i / 12) * 2 * Math.PI + 0.2 * random()),
    }));
    return { nodes, edges: [] };
  }
  if (id === 'clusters') {
    const centres = [
      { x: 0.2, y: 0.28 },
      { x: 0.75, y: 0.25 },
      { x: 0.5, y: 0.78 },
    ];
    const nodes = centres.flatMap((c) =>
      scatter(6, random).map((p) => ({ x: c.x + (p.x - 0.5) * 0.28, y: c.y + (p.y - 0.5) * 0.32 })),
    );
    return { nodes, edges: [] };
  }
  return { nodes: scatter(18, random), edges: [] };
}

/** Width over height of the area the points are drawn in, near enough at every canvas size. */
const ASPECT = 1.6;

/** A repeatable pseudo-random weight in 1..99 for a pair of nodes. */
function pairWeight(a: number, b: number, seed: number): number {
  let h = Math.imul(a * 73 + b * 151 + seed * 31 + 7, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return 1 + ((h >>> 0) % 99);
}

export const mount: Mount = (root, entry) => {
  const { about, dispose } = graphLab<MstFrame, 'picked' | 'weight' | 'parts' | 'seen'>({
    root,
    entry,
    canvasLabel:
      'Points joined by weighted edges. The edges chosen for the minimum spanning tree are drawn thick; a bar chart underneath lists all edges by weight.',
    directed: false,
    labelled: false,
    maxNodes: 40,
    maxWeight: 200,
    strip: (height) => Math.max(34, Math.min(56, height * 0.14)),
    algorithms: ALGORITHMS,
    presets: PRESETS,
    extra: { edges: 'near', weights: 'length' },
    makePreset: preset,
    manualEdges: false,
    geometryMatters: true,
    speed: 3,
    caption: (id) =>
      id === 'prim'
        ? 'Grows one tree from a start node, always adding the lightest edge that leaves it.'
        : 'Takes edges lightest first and keeps each one that joins two separate components.',
    normalise(graph, lab) {
      // Lengths are measured as drawn: the canvas is wider than it is tall.
      const drawn = graph.nodes.map((p) => ({ x: p.x * ASPECT, y: p.y }));
      const pairs = lab.settings.edges === 'all' ? allPairs(drawn.length) : gabrielPairs(drawn);
      const seed = Number(lab.settings.seed) || 0;
      graph.edges = pairs.map(([a, b]) => ({
        a,
        b,
        w:
          lab.settings.weights === 'random'
            ? pairWeight(a, b, seed)
            : lengthWeight(drawn[a], drawn[b]),
      }));
    },
    run: (graph, algorithm) => (algorithm === 'prim' ? prim : kruskal)(graph).frames,
    controls: (lab) => [
      select({
        label: 'Candidate edges',
        options: EDGE_SETS,
        value: lab.settings.edges === 'all' ? 'all' : 'near',
        onChange(id) {
          lab.settings.edges = id;
          lab.rebuild();
        },
      }).root,
      select({
        label: 'Edge weights',
        options: WEIGHTS,
        value: lab.settings.weights === 'random' ? 'random' : 'length',
        onChange(id) {
          lab.settings.weights = id;
          lab.rebuild();
        },
      }).root,
    ],
    counters: {
      picked: 'Tree edges',
      weight: 'Total weight',
      parts: 'Components',
      seen: 'Edges examined',
    },
    count: (frame, lab) => ({
      picked: `${frame.picked} of ${Math.max(0, lab.graph().nodes.length - 1)}`,
      weight: frame.weight,
      parts: lab.graph().nodes.length - frame.picked,
      seen: lab.settings.alg === 'prim' ? '–' : `${frame.scanned} of ${lab.graph().edges.length}`,
    }),
    legend: [
      ['var(--canvas-change)', 'Edge being decided'],
      ['var(--canvas-compare)', 'Crosses the cut (Prim)'],
      ['var(--canvas-series-1)', 'In the tree, one colour per component'],
      ['var(--canvas-faint)', 'Rejected: would close a cycle'],
    ],
    draw({ ctx, palette, view, width, height, graph, frame }, lab) {
      const series = (slot: number) => palette.series[slot % palette.series.length];
      const edgeColour = (i: number) => {
        const role = frame.edges[i];
        if (role === 'tree') return series(Math.max(0, frame.group[graph.edges[i].a]));
        if (role === 'current') return palette.change;
        if (role === 'candidate') return palette.compare;
        return role === 'rejected' ? palette.faint : palette.muted;
      };
      // Weight labels only where there is room for them.
      const roomy = graph.edges.length <= 40 && width >= 480;
      drawGraph(ctx, palette, view, graph, {
        directed: false,
        edge(i) {
          const role = frame.edges[i];
          const strong = role === 'tree' || role === 'current';
          return {
            colour: edgeColour(i),
            width: strong ? 3 : role === 'candidate' ? 2 : 1,
            label:
              role === 'current' || (roomy && role !== 'rejected')
                ? String(graph.edges[i].w)
                : undefined,
          };
        },
        node(i) {
          const slot = frame.group[i];
          return slot < 0
            ? { fill: palette.bg, stroke: palette.muted }
            : { fill: series(slot), stroke: tint(series(slot), palette, 0.3) };
        },
      });

      // The sorted edge list as bars: height is weight, colour is the edge's fate.
      const order = [...graph.edges.keys()].sort(
        (p, q) => graph.edges[p].w - graph.edges[q].w || p - q,
      );
      const strip =
        lab.settings.alg === 'prim' ? 'Edges by weight' : 'Edges by weight, taken left to right';
      const top = height - Math.max(34, Math.min(56, height * 0.14));
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = palette.muted;
      ctx.fillText(strip, 10, top);
      if (order.length === 0) return;
      const base = height - 6;
      const tall = base - top - 16;
      const slot = Math.min(14, (width - 20) / order.length);
      const heaviest = graph.edges[order[order.length - 1]].w;
      order.forEach((edge, k) => {
        const h = Math.max(2, (tall * graph.edges[edge].w) / heaviest);
        ctx.fillStyle = edgeColour(edge);
        ctx.fillRect(10 + k * slot, base - h, Math.max(1, slot - (slot > 3 ? 1 : 0)), h);
      });
      if (lab.settings.alg !== 'prim' && frame.scanned > 0) {
        ctx.fillStyle = palette.ink;
        ctx.fillRect(10 + frame.scanned * slot - 0.5, base - tall - 2, 1, tall + 4);
      }
    },
  });

  about.append(
    prose(
      'A spanning tree joins all the nodes using as few edges as possible: `n − 1` of them, with no cycle. The minimum spanning tree is the one whose edge weights add up to the least. Here the weight of an edge is its length on screen, with the height of the drawing counting as 100, so the tree is the cheapest way to wire the points together.',
    ),
    prose(
      'Both algorithms are greedy and both rest on the cut property: split the nodes into two groups in any way, and the lightest edge running between the groups belongs to a minimum spanning tree. Prim always uses the cut between its tree and everything else. Kruskal sorts the edges and takes each one whose ends lie in different components, which it tracks with a union-find structure; the cut is between one of those components and the rest.',
    ),
    formula(
      'Kruskal:  sort edges;  for each (u, v) lightest first:  if find(u) ≠ find(v): keep it, union(u, v)\nPrim:     tree = {start};  repeat: add the lightest edge with exactly one end in the tree',
    ),
    prose(
      'Kruskal costs `O(E log E)` for the sort. Prim with a binary heap costs `O(E log V)`. With "Nearby pairs" the candidate edges are the Gabriel graph: two points are joined when no third point lies in the circle between them. It always contains the minimum spanning tree and keeps the picture readable. Drag a point after the run has finished and the tree updates as you move it.',
    ),
  );
  return dispose;
};
