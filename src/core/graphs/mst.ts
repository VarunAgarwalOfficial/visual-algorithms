import type { EdgeRole, Graph } from './graph';
import { UnionFind } from './unionfind';

export interface MstFrame {
  note: string;
  edges: EdgeRole[];
  /** Colour slot of each node's component, or -1 for a node not yet in any tree. */
  group: number[];
  weight: number;
  picked: number;
  /** Kruskal: how many edges of the sorted list have been looked at. */
  scanned: number;
}

export interface MstRun {
  frames: MstFrame[];
  /** Edge indices in increasing weight order. */
  sorted: number[];
  /** Edge indices of the final tree (or forest). */
  tree: number[];
  weight: number;
}

function sortedEdges(graph: Graph): number[] {
  return graph.edges.map((_, i) => i).sort((p, q) => graph.edges[p].w - graph.edges[q].w || p - q);
}

function closing(graph: Graph, tree: number[], weight: number, trees: number): string {
  if (graph.nodes.length === 0) return 'No nodes. Click the canvas to add some.';
  if (graph.nodes.length === 1) return 'One node: the tree is that node, with weight 0.';
  if (trees > 1) {
    return `The graph is not connected, so the result is a forest of ${trees} trees. Total weight ${weight}.`;
  }
  return `Done: ${tree.length} edges join all ${graph.nodes.length} nodes. Total weight ${weight}.`;
}

/** Kruskal: take the edges lightest first, keep each one that joins two different components. */
export function kruskal(graph: Graph): MstRun {
  const n = graph.nodes.length;
  const sorted = sortedEdges(graph);
  const sets = new UnionFind(n);
  const roles: EdgeRole[] = graph.edges.map(() => 'idle');
  const group: number[] = new Array<number>(n).fill(-1);
  const tree: number[] = [];
  const frames: MstFrame[] = [];
  let weight = 0;
  let slots = 0;
  let scanned = 0;
  const snap = (note: string) =>
    frames.push({
      note,
      edges: [...roles],
      group: [...group],
      weight,
      picked: tree.length,
      scanned,
    });

  snap(`Sort the ${sorted.length} edges by weight. Every node starts as its own component.`);
  for (const edge of sorted) {
    if (tree.length >= n - 1) break;
    const { a, b, w } = graph.edges[edge];
    scanned++;
    if (sets.find(a) === sets.find(b)) {
      roles[edge] = 'current';
      snap(
        `Weight ${w}: both ends are already in one component. It would close a cycle, so skip it.`,
      );
      roles[edge] = 'rejected';
      continue;
    }
    // The merged component keeps the colour of the larger part.
    const keep = sets.sizeOf(a) >= sets.sizeOf(b) ? group[a] : group[b];
    const slot = keep >= 0 ? keep : slots++ % 6;
    sets.union(a, b);
    const root = sets.find(a);
    for (let i = 0; i < n; i++) if (sets.find(i) === root) group[i] = slot;
    tree.push(edge);
    weight += w;
    roles[edge] = 'current';
    snap(`Weight ${w}: the ends are in different components. Keep the edge and merge them.`);
    roles[edge] = 'tree';
  }
  const trees = n - tree.length;
  snap(closing(graph, tree, weight, trees));
  return { frames, sorted, tree, weight };
}

/** Prim: grow one tree, always adding the lightest edge that leaves it. */
export function prim(graph: Graph, start = 0): MstRun {
  const n = graph.nodes.length;
  const sorted = sortedEdges(graph);
  const inside = new Uint8Array(n);
  // Which restart reached each node; only matters when the graph is not connected.
  const treeOf = new Int32Array(n).fill(-1);
  const roles: EdgeRole[] = graph.edges.map(() => 'idle');
  const group: number[] = new Array<number>(n).fill(-1);
  const tree: number[] = [];
  const frames: MstFrame[] = [];
  let weight = 0;
  let trees = 0;
  const snap = (note: string) =>
    frames.push({
      note,
      edges: [...roles],
      group: [...group],
      weight,
      picked: tree.length,
      scanned: 0,
    });

  for (let offset = 0; offset < n; offset++) {
    const seed = (start + offset) % n;
    if (inside[seed]) continue;
    inside[seed] = 1;
    treeOf[seed] = trees;
    group[seed] = trees % 6;
    let size = 1;
    let first = true;
    for (;;) {
      // The cut: edges with exactly one end inside the tree.
      let best = -1;
      let crossing = 0;
      graph.edges.forEach((e, i) => {
        if (roles[i] === 'tree') return;
        const cross = (treeOf[e.a] === trees) !== (treeOf[e.b] === trees);
        const within = inside[e.a] && inside[e.b];
        roles[i] = cross ? 'candidate' : within ? 'rejected' : 'idle';
        if (!cross) return;
        crossing++;
        if (best < 0 || e.w < graph.edges[best].w) best = i;
      });
      if (best < 0) {
        if (first)
          snap(trees === 0 ? 'Start from one node.' : 'Start again from an unreached node.');
        break;
      }
      const e = graph.edges[best];
      roles[best] = 'current';
      const opening = first ? (trees === 0 ? 'Start from one node. ' : 'Start a new tree. ') : '';
      snap(
        `${opening}${crossing} edge${crossing === 1 ? '' : 's'} cross the cut between the tree (${size} node${size === 1 ? '' : 's'}) and the rest. The lightest, weight ${e.w}, is safe to add.`,
      );
      first = false;
      const fresh = inside[e.a] ? e.b : e.a;
      inside[fresh] = 1;
      treeOf[fresh] = trees;
      group[fresh] = trees % 6;
      size++;
      roles[best] = 'tree';
      tree.push(best);
      weight += e.w;
    }
    trees++;
  }
  graph.edges.forEach((_, i) => {
    if (roles[i] !== 'tree') roles[i] = 'rejected';
  });
  snap(closing(graph, tree, weight, trees));
  return { frames, sorted, tree, weight };
}
