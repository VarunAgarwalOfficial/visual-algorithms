import { SCC_PRESETS, letter, sccPreset, type Graph } from '../../core/graphs/graph';
import { kosaraju, tarjan, type SccFrame } from '../../core/graphs/scc';
import { formula, prose, type Mount } from '../layout';
import { SWATCH, drawChips, drawGraph, roleEdge, roleNode, tint } from './graphview';
import { graphLab } from './lab';

const ALGORITHMS = [
  { id: 'tarjan', name: "Tarjan's algorithm" },
  { id: 'kosaraju', name: "Kosaraju's algorithm" },
] as const;

export const mount: Mount = (root, entry) => {
  const { about, dispose } = graphLab<SccFrame, 'found' | 'stack' | 'visited'>({
    root,
    entry,
    canvasLabel:
      'A directed graph of lettered nodes. Each strongly connected component takes its own colour as it is found.',
    directed: true,
    labelled: true,
    maxNodes: 16,
    maxWeight: 1,
    strip: () => 70,
    algorithms: ALGORITHMS,
    presets: SCC_PRESETS,
    makePreset: sccPreset,
    manualEdges: true,
    caption: (id) =>
      id === 'kosaraju'
        ? 'Two depth-first searches: one to get a finishing order, one on the reversed graph.'
        : 'One depth-first search. Each node records the earliest stack node it can reach, its lowlink.',
    run: (graph, algorithm) => (algorithm === 'kosaraju' ? kosaraju : tarjan)(graph, letter).frames,
    counters: { found: 'Components found', stack: 'On the stack', visited: 'Nodes visited' },
    count: (frame, lab) => ({
      found: new Set(frame.comp.filter((c) => c >= 0)).size,
      stack: frame.stack.length,
      visited:
        lab.settings.alg === 'kosaraju'
          ? frame.reversed
            ? frame.comp.filter((c) => c >= 0).length
            : frame.nodes.filter((r) => r !== 'idle').length
          : frame.index.filter((i) => i >= 0).length,
    }),
    legend: [
      [SWATCH.current, 'Current'],
      [SWATCH.frontier, 'On the stack'],
      [SWATCH.tree, 'Search tree edge'],
      ['var(--canvas-series-3)', 'One colour per component'],
    ],
    draw({ ctx, palette, view, width, height, graph, frame }, lab) {
      const tarjanRun = lab.settings.alg !== 'kosaraju';
      // In Kosaraju's second pass the edges are drawn the way they are followed.
      const shown: Graph = frame.reversed
        ? { nodes: graph.nodes, edges: graph.edges.map((e) => ({ ...e, a: e.b, b: e.a })) }
        : graph;
      const node = (i: number) => {
        const colour = palette.series[frame.comp[i] % palette.series.length];
        if (frame.comp[i] >= 0 && frame.nodes[i] !== 'current') {
          return { fill: tint(colour, palette, 0.5), stroke: colour, width: 2 };
        }
        // Kosaraju's first pass marks finished nodes; they have no component yet.
        return roleNode(frame.nodes[i], palette);
      };
      drawGraph(ctx, palette, view, shown, {
        directed: true,
        edge(i) {
          const e = graph.edges[i];
          const inside = frame.comp[e.a] >= 0 && frame.comp[e.a] === frame.comp[e.b];
          if (inside && frame.edges[i] === 'tree') {
            return { colour: palette.series[frame.comp[e.a] % palette.series.length], width: 3 };
          }
          return roleEdge(frame.edges[i], palette);
        },
        node: (i) => ({
          ...node(i),
          text: letter(i),
          sub: tarjanRun && frame.index[i] >= 0 ? `${frame.index[i]} / ${frame.low[i]}` : '',
        }),
      });
      const chip = (i: number) => ({ text: letter(i), fill: node(i).fill });
      const box = { x: 10, width: width - 20, height: 30 };
      drawChips(
        ctx,
        palette,
        { ...box, y: height - 66 },
        tarjanRun ? 'Stack (top right)' : 'Search path',
        frame.stack.map(chip),
      );
      if (tarjanRun) {
        const grouped = graph.nodes
          .map((_, i) => i)
          .filter((i) => frame.comp[i] >= 0)
          .sort((p, q) => frame.comp[p] - frame.comp[q] || p - q);
        drawChips(ctx, palette, { ...box, y: height - 33 }, 'Components', grouped.map(chip));
      } else {
        drawChips(
          ctx,
          palette,
          { ...box, y: height - 33 },
          'Finishing order (pass 2 reads it right to left)',
          frame.finished.map(chip),
        );
      }
    },
  });

  about.append(
    prose(
      'Two nodes are strongly connected when each can reach the other along the arrows. That splits a directed graph into components. Shrink every component to a single node and what is left has no cycles: the condensation, a directed acyclic graph.',
    ),
    prose(
      "Tarjan's algorithm numbers the nodes in the order a depth-first search finds them, the `index`, and keeps them on a stack until their component is known. The second number under a node is its `lowlink`: the smallest index it can reach among nodes still on the stack. A node whose lowlink equals its own index cannot get back to anything earlier, so it and everything above it on the stack form one component.",
    ),
    formula(
      'visit(v):  index[v] = low[v] = next++;  push v\n           for each v→w:  not visited:  visit(w); low[v] = min(low[v], low[w])\n                          on the stack: low[v] = min(low[v], index[w])\n           if low[v] = index[v]: pop down to v, that is one component',
    ),
    prose(
      "Kosaraju's algorithm uses the fact that reversing every edge keeps the components but reverses the condensation. The node that finishes last in a first search lies in a component nothing else leads into. Searching from it in the reversed graph can then reach only its own component. Both algorithms run in `O(V + E)`; Tarjan needs one pass.",
    ),
  );
  return dispose;
};
