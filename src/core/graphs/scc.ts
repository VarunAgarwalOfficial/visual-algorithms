import { adjacency, type EdgeRole, type Graph, type Label, type NodeRole } from './graph';

export interface SccFrame {
  note: string;
  nodes: NodeRole[];
  edges: EdgeRole[];
  /** Component number of each node, or -1 while unknown. */
  comp: number[];
  /** Tarjan: discovery index and lowlink, -1 before the visit. */
  index: number[];
  low: number[];
  /** Tarjan: the component stack. Kosaraju: the search path. Bottom first. */
  stack: number[];
  /** Kosaraju: nodes in the order they finished in the first pass. */
  finished: number[];
  /** Kosaraju: true while the second pass follows edges backwards. */
  reversed: boolean;
}

export interface SccRun {
  frames: SccFrame[];
  comp: number[];
  count: number;
  /** Edges of the condensation: distinct pairs of components joined by an edge. */
  condensationEdges: number;
}

interface Recorder extends Omit<SccFrame, 'note'> {
  frames: SccFrame[];
  snap(note: string): void;
}

function recorder(graph: Graph): Recorder {
  const blank = () => graph.nodes.map(() => -1);
  const r: Recorder = {
    nodes: graph.nodes.map(() => 'idle'),
    edges: graph.edges.map(() => 'idle'),
    comp: blank(),
    index: blank(),
    low: blank(),
    stack: [],
    finished: [],
    reversed: false,
    frames: [],
    snap(note) {
      r.frames.push({
        note,
        nodes: [...r.nodes],
        edges: [...r.edges],
        comp: [...r.comp],
        index: [...r.index],
        low: [...r.low],
        stack: [...r.stack],
        finished: [...r.finished],
        reversed: r.reversed,
      });
    },
  };
  return r;
}

function summary(graph: Graph, r: Recorder, count: number): SccRun {
  const pairs = new Set<number>();
  for (const e of graph.edges) {
    if (r.comp[e.a] !== r.comp[e.b]) pairs.add(r.comp[e.a] * 1000 + r.comp[e.b]);
  }
  r.snap(
    graph.nodes.length === 0
      ? 'No nodes.'
      : `Done: ${count} component${count === 1 ? '' : 's'}. Shrinking each to a single node leaves a graph with ${pairs.size} edge${pairs.size === 1 ? '' : 's'} and no cycles.`,
  );
  return { frames: r.frames, comp: r.comp, count, condensationEdges: pairs.size };
}

const set = (list: readonly number[], label: Label) => `{${list.map(label).join(', ')}}`;

/** Tarjan's algorithm: one depth-first search with a stack and a lowlink per node. */
export function tarjan(graph: Graph, label: Label): SccRun {
  const r = recorder(graph);
  const adj = adjacency(graph, true);
  const onStack = new Uint8Array(graph.nodes.length);
  let counter = 0;
  let count = 0;
  const visit = (v: number, from: number) => {
    r.index[v] = r.low[v] = counter++;
    r.stack.push(v);
    onStack[v] = 1;
    r.nodes[v] = 'current';
    r.snap(
      `${from < 0 ? 'Start at' : 'Visit'} ${label(v)}: index and lowlink are both ${r.index[v]}. Push it on the stack.`,
    );
    for (const { to, edge } of adj[v]) {
      if (r.index[to] < 0) {
        r.edges[edge] = 'tree';
        r.nodes[v] = 'frontier';
        visit(to, v);
        r.nodes[v] = 'current';
        const before = r.low[v];
        r.low[v] = Math.min(r.low[v], r.low[to]);
        r.snap(
          `Back at ${label(v)} from ${label(to)}: lowlink is min(${before}, lowlink of ${label(to)} = ${r.low[to]}) = ${r.low[v]}.`,
        );
      } else if (onStack[to]) {
        const before = r.low[v];
        r.low[v] = Math.min(r.low[v], r.index[to]);
        r.edges[edge] = 'current';
        r.snap(
          `${label(v)}→${label(to)}: ${label(to)} is on the stack, so it can reach back to ${label(v)}. Lowlink is min(${before}, index of ${label(to)} = ${r.index[to]}) = ${r.low[v]}.`,
        );
        r.edges[edge] = 'candidate';
      } else {
        r.edges[edge] = 'current';
        r.snap(
          `${label(v)}→${label(to)}: ${label(to)} is in a finished component. Ignore the edge.`,
        );
        r.edges[edge] = 'rejected';
      }
    }
    if (r.low[v] === r.index[v]) {
      const members: number[] = [];
      for (;;) {
        const w = r.stack.pop() as number;
        onStack[w] = 0;
        r.comp[w] = count;
        r.nodes[w] = 'done';
        members.push(w);
        if (w === v) break;
      }
      count++;
      r.snap(
        `Lowlink of ${label(v)} equals its index, so it is the root of a component. Pop the stack down to ${label(v)}: ${set(members.reverse(), label)}.`,
      );
    } else {
      r.nodes[v] = 'frontier';
      r.snap(
        `${label(v)} can reach an earlier node (lowlink ${r.low[v]} < index ${r.index[v]}). It stays on the stack.`,
      );
    }
  };
  for (let i = 0; i < graph.nodes.length; i++) if (r.index[i] < 0) visit(i, -1);
  for (const e of graph.edges.keys()) {
    r.edges[e] = r.comp[graph.edges[e].a] === r.comp[graph.edges[e].b] ? 'tree' : 'rejected';
  }
  return summary(graph, r, count);
}

/** Kosaraju's algorithm: a search for finishing order, then a search on the reversed graph. */
export function kosaraju(graph: Graph, label: Label): SccRun {
  const r = recorder(graph);
  const n = graph.nodes.length;
  const adj = adjacency(graph, true);
  const back = adjacency(
    { nodes: graph.nodes, edges: graph.edges.map((e) => ({ ...e, a: e.b, b: e.a })) },
    true,
  );

  const first = (v: number) => {
    r.nodes[v] = 'current';
    r.stack.push(v);
    r.snap(`Pass 1: visit ${label(v)}.`);
    for (const { to, edge } of adj[v]) {
      if (r.nodes[to] !== 'idle') continue;
      r.edges[edge] = 'tree';
      r.nodes[v] = 'frontier';
      first(to);
      r.nodes[v] = 'current';
    }
    r.nodes[v] = 'done';
    r.stack.pop();
    r.finished.push(v);
    const top = r.stack[r.stack.length - 1];
    if (top !== undefined) r.nodes[top] = 'current';
    r.snap(`Pass 1: ${label(v)} is finished. Note it at the end of the finishing order.`);
  };
  for (let i = 0; i < n; i++) if (r.nodes[i] === 'idle') first(i);

  r.nodes.fill('idle');
  r.edges.fill('idle');
  r.reversed = true;
  if (n > 0) {
    r.snap('Pass 2: reverse every edge, then take the nodes in reverse finishing order.');
  }
  let count = 0;
  const second = (v: number, members: number[]) => {
    r.comp[v] = count;
    r.nodes[v] = 'done';
    members.push(v);
    for (const { to, edge } of back[v]) {
      if (r.comp[to] >= 0) {
        if (r.edges[edge] === 'idle') r.edges[edge] = 'rejected';
        continue;
      }
      r.edges[edge] = 'tree';
      r.snap(
        `Pass 2: ${label(to)} reaches ${label(v)} (edge ${label(to)}→${label(v)} followed backwards). Same component.`,
      );
      second(to, members);
    }
  };
  for (let i = n - 1; i >= 0; i--) {
    const v = r.finished[i];
    if (r.comp[v] >= 0) continue;
    r.nodes[v] = 'current';
    r.comp[v] = count;
    r.snap(
      `Pass 2: ${label(v)} finished last among the nodes left. Start a new component from it.`,
    );
    const members: number[] = [];
    second(v, members);
    count++;
    r.snap(`Nothing more reaches ${label(v)}: component ${set(members, label)} is complete.`);
  }
  r.reversed = false;
  for (const e of graph.edges.keys()) {
    r.edges[e] = r.comp[graph.edges[e].a] === r.comp[graph.edges[e].b] ? 'tree' : 'rejected';
  }
  return summary(graph, r, count);
}
