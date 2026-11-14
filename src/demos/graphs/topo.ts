import { DAG_PRESETS, dagPreset, letter } from '../../core/graphs/graph';
import { kahn, topologicalDfs, type TraverseFrame } from '../../core/graphs/traverse';
import { formula, prose, type Mount } from '../layout';
import { SWATCH, drawChips, drawGraph, roleEdge, roleNode } from './graphview';
import { graphLab } from './lab';

const ALGORITHMS = [
  { id: 'kahn', name: "Kahn's algorithm" },
  { id: 'dfs', name: 'Depth-first' },
] as const;

export const mount: Mount = (root, entry) => {
  const { about, dispose } = graphLab<TraverseFrame, 'placed' | 'bag' | 'edges'>({
    root,
    entry,
    canvasLabel:
      'A directed graph of lettered nodes. Nodes change colour as they are placed in the order listed underneath.',
    directed: true,
    labelled: true,
    maxNodes: 20,
    maxWeight: 1,
    strip: () => 54,
    algorithms: ALGORITHMS,
    presets: DAG_PRESETS,
    makePreset: dagPreset,
    manualEdges: true,
    hint: 'Draw an edge backwards to make a cycle.',
    caption: (id) =>
      id === 'dfs'
        ? 'A node is finished only after everything it points to. Reverse finishing order is a valid order.'
        : 'Repeatedly takes a node nothing points to and removes its outgoing edges.',
    run: (graph, algorithm) => (algorithm === 'dfs' ? topologicalDfs : kahn)(graph, letter).frames,
    counters: { placed: 'Placed', bag: 'Waiting', edges: 'Edges' },
    count: (frame, lab) => ({
      placed: `${frame.order.length} of ${lab.graph().nodes.length}`,
      bag: frame.bag.length,
      edges: lab.graph().edges.length,
    }),
    legend: [
      [SWATCH.current, 'Current; dashed edges are on a cycle or stuck behind one'],
      [SWATCH.frontier, 'Waiting'],
      [SWATCH.done, 'Placed'],
      [SWATCH.tree, 'Search tree edge'],
      [SWATCH.skipped, 'Edge dealt with'],
    ],
    draw({ ctx, palette, view, width, height, graph, frame }, lab) {
      const dfs = lab.settings.alg === 'dfs';
      drawGraph(ctx, palette, view, graph, {
        directed: true,
        edge: (i) => roleEdge(frame.edges[i], palette),
        node: (i) => ({
          ...roleNode(frame.nodes[i], palette),
          text: letter(i),
          sub: frame.sub[i] < 0 ? '' : `in ${frame.sub[i]}`,
        }),
      });
      const chip = (i: number) => ({
        text: letter(i),
        fill: roleNode(frame.nodes[i], palette).fill,
      });
      const box = { x: 10, width: width - 20, height: 24 };
      drawChips(
        ctx,
        palette,
        { ...box, y: height - 52 },
        dfs ? 'Stack (top right)' : 'Queue (front left)',
        frame.bag.map(chip),
      );
      drawChips(ctx, palette, { ...box, y: height - 27 }, 'Order', frame.order.map(chip));
    },
  });

  about.append(
    prose(
      'A topological order lists the nodes of a directed graph so that every edge points from an earlier node to a later one. Read an edge `A→B` as "A must come before B": the order is then a valid schedule. One exists exactly when the graph has no cycle.',
    ),
    prose(
      "Kahn's algorithm keeps a count of incoming edges for each node, shown as `in`. A node with a count of zero has nothing left that must come before it, so it can be placed. Placing it removes its outgoing edges, which may free other nodes. If nodes remain when the queue runs dry, they lie on a cycle or behind one.",
    ),
    formula(
      'Kahn:         queue = nodes with in-degree 0\n              take v, append v; for each v→w: in[w] −= 1, queue w when it reaches 0\ndepth-first:  visit(v): for each v→w not visited: visit(w); then put v at the FRONT',
    ),
    prose(
      'The depth-first version finishes a node only after everything reachable from it, so putting each finished node at the front leaves it ahead of all its successors. An edge to a node that is still on the stack is a back edge and proves a cycle. Both run in `O(V + E)`.',
    ),
  );
  return dispose;
};
