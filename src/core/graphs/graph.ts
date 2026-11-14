import { packPoints, unpackPoints } from '../encode';
import type { Point } from '../point';
import type { Random } from '../random';

export interface Edge {
  a: number;
  b: number;
  /** Weight or capacity. */
  w: number;
}

/** A small node-link graph. Node positions are in the unit square. */
export interface Graph {
  nodes: Point[];
  edges: Edge[];
}

/** How a node or edge should be drawn at one moment of an algorithm. */
export type NodeRole = 'idle' | 'frontier' | 'current' | 'done';
export type EdgeRole = 'idle' | 'candidate' | 'current' | 'tree' | 'rejected' | 'cut';

export type Label = (node: number) => string;

/** A, B, ... Z, then a, b, ... */
export const letter: Label = (i) => String.fromCharCode(i < 26 ? 65 + i : 97 + ((i - 26) % 26));

export const cloneGraph = (graph: Graph): Graph => ({
  nodes: graph.nodes.map((p) => ({ ...p })),
  edges: graph.edges.map((e) => ({ ...e })),
});

export function findEdge(graph: Graph, a: number, b: number, directed: boolean): number {
  return graph.edges.findIndex(
    (e) => (e.a === a && e.b === b) || (!directed && e.a === b && e.b === a),
  );
}

/** Adds the edge a→b, or removes it if it is already there. */
export function toggleEdge(graph: Graph, a: number, b: number, directed: boolean, w: number): void {
  if (a === b) return;
  const at = findEdge(graph, a, b, directed);
  if (at >= 0) graph.edges.splice(at, 1);
  else graph.edges.push({ a, b, w });
}

/** Removes a node and its edges; later nodes move down one index. */
export function removeNode(graph: Graph, node: number): void {
  graph.nodes.splice(node, 1);
  graph.edges = graph.edges
    .filter((e) => e.a !== node && e.b !== node)
    .map((e) => ({ a: e.a > node ? e.a - 1 : e.a, b: e.b > node ? e.b - 1 : e.b, w: e.w }));
}

export interface Arc {
  to: number;
  edge: number;
}

/** Outgoing arcs per node, sorted by target. Undirected graphs get both directions. */
export function adjacency(graph: Graph, directed: boolean): Arc[][] {
  const out: Arc[][] = graph.nodes.map(() => []);
  graph.edges.forEach((e, edge) => {
    out[e.a].push({ to: e.b, edge });
    if (!directed) out[e.b].push({ to: e.a, edge });
  });
  for (const list of out) list.sort((p, q) => p.to - q.to);
  return out;
}

// --- URL encoding ---

const INDEX = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** "points_edges": points as packPoints, each edge as two index characters and a base-36 weight. */
export function encodeGraph(graph: Graph): string {
  const edges = graph.edges.map((e) => INDEX[e.a] + INDEX[e.b] + e.w.toString(36));
  return `${packPoints(graph.nodes)}_${edges.join('.')}`;
}

/**
 * Reads a graph from the URL. Anything malformed is dropped: nodes past the cap,
 * edges to missing nodes, self-loops and duplicates. Weights are clamped.
 * Returns undefined when no nodes survive.
 */
export function decodeGraph(
  text: string,
  limits: { maxNodes: number; maxWeight: number; directed: boolean },
): Graph | undefined {
  const [pointText, edgeText = ''] = text.split('_');
  const nodes = unpackPoints(pointText ?? '').slice(0, Math.min(limits.maxNodes, INDEX.length));
  if (nodes.length === 0) return undefined;
  const graph: Graph = { nodes, edges: [] };
  for (const part of edgeText.split('.').slice(0, 2000)) {
    if (part.length < 3) continue;
    const a = INDEX.indexOf(part[0]);
    const b = INDEX.indexOf(part[1]);
    const w = /^[0-9a-z]+$/.test(part.slice(2)) ? Number.parseInt(part.slice(2), 36) : NaN;
    if (a < 0 || b < 0 || a >= nodes.length || b >= nodes.length || a === b) continue;
    if (!Number.isFinite(w) || findEdge(graph, a, b, limits.directed) >= 0) continue;
    graph.edges.push({ a, b, w: Math.max(1, Math.min(limits.maxWeight, w)) });
  }
  return graph;
}

// --- Geometry ---

/** Euclidean length scaled so the unit square's side is 100. Always at least 1. */
export function lengthWeight(p: Point, q: Point): number {
  return Math.max(1, Math.round(100 * Math.hypot(p.x - q.x, p.y - q.y)));
}

/**
 * The Gabriel graph: a and b are joined when no other point lies inside the
 * circle with diameter ab. It is planar, connected, and contains the Euclidean
 * minimum spanning tree.
 */
export function gabrielPairs(points: readonly Point[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const mx = (points[a].x + points[b].x) / 2;
      const my = (points[a].y + points[b].y) / 2;
      const r2 = ((points[a].x - points[b].x) ** 2 + (points[a].y - points[b].y) ** 2) / 4;
      let empty = true;
      for (let c = 0; c < points.length && empty; c++) {
        if (c === a || c === b) continue;
        if ((points[c].x - mx) ** 2 + (points[c].y - my) ** 2 < r2 - 1e-12) empty = false;
      }
      if (empty) pairs.push([a, b]);
    }
  }
  return pairs;
}

export function allPairs(count: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) pairs.push([a, b]);
  return pairs;
}

/** Random points that keep some distance from each other and from the border. */
export function scatter(count: number, random: Random): Point[] {
  const points: Point[] = [];
  let gap = 0.9 / Math.sqrt(Math.max(1, count));
  while (points.length < count) {
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const p = { x: 0.04 + 0.92 * random(), y: 0.04 + 0.92 * random() };
      if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) {
        points.push(p);
        placed = true;
      }
    }
    if (!placed) gap *= 0.85;
  }
  return points;
}

const at = (x: number, y: number): Point => ({ x, y });
const link = (pairs: readonly (readonly [number, number, number?])[]): Edge[] =>
  pairs.map(([a, b, w]) => ({ a, b, w: w ?? 1 }));

// --- Presets: undirected graphs for breadth-first and depth-first search ---

export type SearchPreset = 'grid' | 'tree' | 'random';
export const SEARCH_PRESETS: readonly { id: SearchPreset; name: string }[] = [
  { id: 'grid', name: 'Grid with gaps' },
  { id: 'tree', name: 'Binary tree' },
  { id: 'random', name: 'Random planar' },
];

export function searchPreset(id: string, random: Random): Graph {
  if (id === 'tree') {
    const nodes: Point[] = [];
    const edges: Edge[] = [];
    for (let depth = 0; depth < 4; depth++) {
      const count = 1 << depth;
      for (let i = 0; i < count; i++) {
        nodes.push(at((i + 0.5) / count, 0.06 + (depth * 0.88) / 3));
        const self = nodes.length - 1;
        if (self > 0) edges.push({ a: (self - 1) >> 1, b: self, w: 1 });
      }
    }
    return { nodes, edges };
  }
  if (id === 'random') {
    const nodes = scatter(14, random);
    return { nodes, edges: gabrielPairs(nodes).map(([a, b]) => ({ a, b, w: 1 })) };
  }
  const nodes: Point[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) nodes.push(at(x / 3, y / 2));
  return {
    nodes,
    edges: link([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [1, 5],
      [3, 7],
      [4, 5],
      [5, 6],
      [4, 8],
      [6, 10],
      [7, 11],
      [8, 9],
      [9, 10],
      [10, 11],
      [2, 6],
    ]),
  };
}

// --- Presets: directed graphs for topological sorting ---

export type DagPreset = 'layers' | 'random' | 'cycle';
export const DAG_PRESETS: readonly { id: DagPreset; name: string }[] = [
  { id: 'layers', name: 'Layered DAG' },
  { id: 'random', name: 'Random DAG' },
  { id: 'cycle', name: 'With a cycle' },
];

export function dagPreset(id: string, random: Random): Graph {
  if (id === 'random') {
    // Sort by x so every edge points right: that guarantees no cycle.
    const nodes = scatter(11, random).sort((p, q) => p.x - q.x);
    const edges = gabrielPairs(nodes)
      .filter(() => random() < 0.8)
      .map(([a, b]) => ({ a, b, w: 1 }));
    return { nodes, edges };
  }
  const nodes = [
    at(0, 0.2),
    at(0, 0.8),
    at(0.33, 0),
    at(0.33, 0.5),
    at(0.33, 1),
    at(0.67, 0.2),
    at(0.67, 0.8),
    at(1, 0.5),
  ];
  const edges = link([
    [0, 2],
    [0, 3],
    [1, 3],
    [1, 4],
    [2, 5],
    [3, 5],
    [3, 6],
    [4, 6],
    [5, 7],
    [6, 7],
  ]);
  if (id === 'cycle') edges.push({ a: 6, b: 1, w: 1 });
  return { nodes, edges };
}

// --- Presets: directed graphs for strongly connected components ---

export type SccPreset = 'classic' | 'rings' | 'random';
export const SCC_PRESETS: readonly { id: SccPreset; name: string }[] = [
  { id: 'classic', name: 'Textbook example' },
  { id: 'rings', name: 'Linked rings' },
  { id: 'random', name: 'Random' },
];

export function sccPreset(id: string, random: Random): Graph {
  if (id === 'rings') {
    return {
      nodes: [
        at(0.02, 0.5),
        at(0.2, 0.1),
        at(0.3, 0.75),
        at(0.5, 0.3),
        at(0.62, 0.95),
        at(0.72, 0.05),
        at(0.98, 0.25),
        at(0.9, 0.75),
        at(0.45, 0.62),
      ],
      edges: link([
        [0, 1],
        [1, 2],
        [2, 0],
        [1, 3],
        [3, 5],
        [5, 6],
        [6, 3],
        [2, 8],
        [8, 4],
        [4, 7],
        [7, 8],
        [6, 7],
      ]),
    };
  }
  if (id === 'random') {
    const nodes = scatter(10, random);
    const edges: Edge[] = [];
    for (const [a, b] of gabrielPairs(nodes)) {
      const r = random();
      if (r < 0.45) edges.push({ a, b, w: 1 });
      else if (r < 0.9) edges.push({ a: b, b: a, w: 1 });
      else edges.push({ a, b, w: 1 }, { a: b, b: a, w: 1 });
    }
    return { nodes, edges };
  }
  // Cormen et al., the eight-node example: components {A, B, E}, {C, D}, {F, G}, {H}.
  const nodes: Point[] = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) nodes.push(at(x / 3, 0.15 + 0.7 * y));
  return {
    nodes,
    edges: link([
      [0, 1],
      [1, 2],
      [1, 4],
      [1, 5],
      [2, 3],
      [2, 6],
      [3, 2],
      [3, 7],
      [4, 0],
      [4, 5],
      [5, 6],
      [6, 5],
      [6, 7],
    ]),
  };
}

// --- Presets: flow networks. Node 0 is the source and node 1 the sink. ---

export type FlowPreset = 'classic' | 'matching' | 'random';
export const FLOW_PRESETS: readonly { id: FlowPreset; name: string }[] = [
  { id: 'classic', name: 'Textbook network' },
  { id: 'matching', name: 'Bipartite matching' },
  { id: 'random', name: 'Random layers' },
];

export function flowPreset(id: string, random: Random): Graph {
  if (id === 'matching') {
    const nodes = [at(0, 0.5), at(1, 0.5)];
    for (let i = 0; i < 4; i++) nodes.push(at(0.33, i / 3));
    for (let i = 0; i < 4; i++) nodes.push(at(0.67, i / 3));
    const edges: Edge[] = [];
    for (let i = 0; i < 4; i++) edges.push({ a: 0, b: 2 + i, w: 1 }, { a: 6 + i, b: 1, w: 1 });
    edges.push(
      ...link([
        [2, 6],
        [2, 7],
        [3, 6],
        [4, 7],
        [4, 8],
        [5, 8],
        [5, 9],
      ]),
    );
    return { nodes, edges };
  }
  if (id === 'random') {
    const nodes = [at(0, 0.5), at(1, 0.5)];
    const layers: number[][] = [[0]];
    for (let layer = 0; layer < 3; layer++) {
      const count = 2 + Math.floor(random() * 2);
      const ids: number[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(nodes.length);
        nodes.push(at(0.25 * (layer + 1), count === 1 ? 0.5 : i / (count - 1)));
      }
      layers.push(ids);
    }
    layers.push([1]);
    const edges: Edge[] = [];
    const capacity = () => 2 + Math.floor(random() * 14);
    for (let layer = 0; layer + 1 < layers.length; layer++) {
      const from = layers[layer];
      const to = layers[layer + 1];
      // Every node gets at least one edge out and one in; some get more.
      from.forEach((a, i) => {
        const b = to[Math.min(to.length - 1, Math.floor((i * to.length) / from.length))];
        edges.push({ a, b, w: capacity() });
      });
      for (const b of to) {
        for (const a of from) {
          const have = edges.some((e) => e.a === a && e.b === b);
          const lonely = !edges.some((e) => e.b === b);
          if (!have && (lonely || random() < 0.35)) edges.push({ a, b, w: capacity() });
        }
      }
    }
    return { nodes, edges };
  }
  // Cormen et al.: maximum flow 23.
  return {
    nodes: [at(0, 0.5), at(1, 0.5), at(0.33, 0.1), at(0.33, 0.9), at(0.67, 0.1), at(0.67, 0.9)],
    edges: link([
      [0, 2, 16],
      [0, 3, 13],
      [2, 4, 12],
      [3, 2, 4],
      [3, 5, 14],
      [4, 3, 9],
      [4, 1, 20],
      [5, 4, 7],
      [5, 1, 4],
    ]),
  };
}
