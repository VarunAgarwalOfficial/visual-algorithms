import { SEARCH_PRESETS, letter, searchPreset } from '../../core/graphs/graph';
import { breadthFirst, depthFirst, type TraverseFrame } from '../../core/graphs/traverse';
import { formula, prose, type Mount } from '../layout';
import { SWATCH, drawChips, drawGraph, roleEdge, roleNode } from './graphview';
import { graphLab } from './lab';

const ALGORITHMS = [
  { id: 'bfs', name: 'Breadth-first search' },
  { id: 'dfs', name: 'Depth-first search' },
] as const;

export const mount: Mount = (root, entry) => {
  const startOf = (settings: Record<string, unknown>, count: number) => {
    const s = Math.round(Number(settings.start));
    return s >= 0 && s < count ? s : 0;
  };
  const { about, dispose } = graphLab<TraverseFrame, 'visited' | 'bag' | 'tree'>({
    root,
    entry,
    canvasLabel:
      'A graph of lettered nodes. Colours show which nodes are waiting, current and finished, with the queue or stack listed underneath.',
    directed: false,
    labelled: true,
    maxNodes: 20,
    maxWeight: 1,
    strip: () => 54,
    algorithms: ALGORITHMS,
    presets: SEARCH_PRESETS,
    extra: { start: 0 },
    makePreset: searchPreset,
    manualEdges: true,
    hint: 'Click a node to start the search from it.',
    caption: (id) =>
      id === 'dfs'
        ? 'Goes as deep as it can along one branch, then backs up. The waiting nodes sit on a stack.'
        : 'Visits nodes in rings of growing distance. The waiting nodes sit in a queue.',
    run(graph, algorithm, lab) {
      const start = startOf(lab.settings, graph.nodes.length);
      return (algorithm === 'dfs' ? depthFirst : breadthFirst)(graph, start, letter).frames;
    },
    onNodeClick(node, lab) {
      lab.settings.start = node;
      lab.rebuild();
    },
    onRemoveNode(node, lab) {
      const start = startOf(lab.settings, lab.graph().nodes.length);
      lab.settings.start = node === start ? 0 : start > node ? start - 1 : start;
    },
    counters: { visited: 'Nodes found', bag: 'Waiting', tree: 'Tree edges' },
    count: (frame, lab) => ({
      visited: frame.order.length,
      bag: frame.bag.length,
      tree: `${frame.edges.filter((r) => r === 'tree').length} of ${lab.graph().edges.length}`,
    }),
    legend: [
      [SWATCH.current, 'Current'],
      [SWATCH.frontier, 'Waiting'],
      [SWATCH.done, 'Finished'],
      [SWATCH.tree, 'Tree edge'],
      [SWATCH.skipped, 'Skipped edge'],
    ],
    draw({ ctx, palette, view, width, height, graph, frame }, lab) {
      const dfs = lab.settings.alg === 'dfs';
      const start = startOf(lab.settings, graph.nodes.length);
      drawGraph(ctx, palette, view, graph, {
        directed: false,
        edge: (i) => roleEdge(frame.edges[i], palette),
        node: (i) => ({
          ...roleNode(frame.nodes[i], palette),
          text: letter(i),
          sub:
            frame.sub[i] < 0
              ? i === start
                ? 'start'
                : ''
              : dfs
                ? `#${frame.sub[i]}`
                : `d=${frame.sub[i]}`,
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
      drawChips(ctx, palette, { ...box, y: height - 27 }, 'Found in order', frame.order.map(chip));
    },
  });

  about.append(
    prose(
      'Both searches visit every node reachable from the start, and both keep a list of nodes found but not yet finished. Breadth-first search takes the oldest from a queue, so it reaches nodes in order of distance: `d` beside a node is the fewest edges from the start. Depth-first search takes the newest from a stack, so it runs down one branch before trying the next.',
    ),
    formula(
      'breadth-first:  take from the front of the queue, add new neighbours at the back\ndepth-first:    visit(v): mark v; for each neighbour w not yet marked: visit(w)',
    ),
    prose(
      'The edges used to reach a node for the first time form a spanning tree of the part reached. The breadth-first tree holds a shortest path to every node. Neighbours are tried in alphabetical order.',
    ),
    prose(
      'Each node is finished once and each edge is looked at from both ends, so both take `O(V + E)` time. Drag nodes, draw or delete edges, and click a node to change the start.',
    ),
  );
  return dispose;
};
