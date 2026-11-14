import { adjacency, type EdgeRole, type Graph, type Label, type NodeRole } from './graph';

export interface TraverseFrame {
  note: string;
  nodes: NodeRole[];
  edges: EdgeRole[];
  /** The queue (front first) or the stack (bottom first). */
  bag: number[];
  /** Discovery order, or the topological order built so far. */
  order: number[];
  /** A number shown beside each node (distance, or remaining in-degree); -1 for none. */
  sub: number[];
}

export interface TraverseRun {
  frames: TraverseFrame[];
  order: number[];
  /** Topological sorts: false when a cycle was found. Always true for plain searches. */
  acyclic: boolean;
}

interface Recorder {
  nodes: NodeRole[];
  edges: EdgeRole[];
  bag: number[];
  order: number[];
  sub: number[];
  frames: TraverseFrame[];
  snap(note: string): void;
}

function recorder(graph: Graph): Recorder {
  const r: Recorder = {
    nodes: graph.nodes.map(() => 'idle'),
    edges: graph.edges.map(() => 'idle'),
    bag: [],
    order: [],
    sub: graph.nodes.map(() => -1),
    frames: [],
    snap(note) {
      r.frames.push({
        note,
        nodes: [...r.nodes],
        edges: [...r.edges],
        bag: [...r.bag],
        order: [...r.order],
        sub: [...r.sub],
      });
    },
  };
  return r;
}

const names = (list: readonly number[], label: Label) => list.map(label).join(', ');

function unreached(r: Recorder, label: Label): string {
  const missed = r.nodes.flatMap((role, i) => (role === 'idle' ? [i] : []));
  if (missed.length === 0) return 'Every node was reached.';
  return `${names(missed, label)} cannot be reached from the start.`;
}

/** Breadth-first search on an undirected graph. The number beside a node is its distance. */
export function breadthFirst(graph: Graph, start: number, label: Label): TraverseRun {
  const r = recorder(graph);
  if (graph.nodes.length === 0) {
    r.snap('No nodes.');
    return { frames: r.frames, order: [], acyclic: true };
  }
  const adj = adjacency(graph, false);
  const via = new Int32Array(graph.nodes.length).fill(-1);
  r.nodes[start] = 'frontier';
  r.sub[start] = 0;
  r.bag.push(start);
  r.order.push(start);
  r.snap(`Start at ${label(start)}: put it in the queue.`);
  while (r.bag.length > 0) {
    const v = r.bag.shift() as number;
    r.nodes[v] = 'current';
    r.snap(`Take ${label(v)} from the front of the queue.`);
    for (const { to, edge } of adj[v]) {
      if (edge === via[v]) continue;
      if (r.nodes[to] === 'idle') {
        r.nodes[to] = 'frontier';
        r.edges[edge] = 'tree';
        r.sub[to] = r.sub[v] + 1;
        via[to] = edge;
        r.bag.push(to);
        r.order.push(to);
        r.snap(`${label(v)}–${label(to)}: ${label(to)} is new. It joins the back of the queue.`);
      } else if (r.edges[edge] === 'idle') {
        r.edges[edge] = 'current';
        r.snap(`${label(v)}–${label(to)}: ${label(to)} was already seen. Skip.`);
        r.edges[edge] = 'rejected';
      }
    }
    r.nodes[v] = 'done';
  }
  r.snap(`The queue is empty. ${unreached(r, label)}`);
  return { frames: r.frames, order: r.order, acyclic: true };
}

/** Depth-first search on an undirected graph. The number beside a node is its discovery time. */
export function depthFirst(graph: Graph, start: number, label: Label): TraverseRun {
  const r = recorder(graph);
  if (graph.nodes.length === 0) {
    r.snap('No nodes.');
    return { frames: r.frames, order: [], acyclic: true };
  }
  const adj = adjacency(graph, false);
  const visit = (v: number, via: number) => {
    r.nodes[v] = 'current';
    r.bag.push(v);
    r.order.push(v);
    r.sub[v] = r.order.length;
    r.snap(
      via < 0
        ? `Start at ${label(v)}: push it on the stack.`
        : `${label(v)} is new: push it and go deeper.`,
    );
    for (const { to, edge } of adj[v]) {
      if (edge === via) continue;
      if (r.nodes[to] === 'idle') {
        r.edges[edge] = 'tree';
        r.nodes[v] = 'frontier';
        visit(to, edge);
        r.nodes[v] = 'current';
      } else if (r.edges[edge] === 'idle') {
        r.edges[edge] = 'current';
        r.snap(`${label(v)}–${label(to)}: ${label(to)} was already visited. Skip.`);
        r.edges[edge] = 'rejected';
      }
    }
    r.nodes[v] = 'done';
    r.bag.pop();
    const top = r.bag[r.bag.length - 1];
    if (top !== undefined) r.nodes[top] = 'current';
    r.snap(
      top === undefined
        ? `${label(v)} has nothing left to try: pop it. The stack is empty.`
        : `${label(v)} has nothing left to try: pop it and return to ${label(top)}.`,
    );
  };
  visit(start, -1);
  r.snap(`Finished. ${unreached(r, label)}`);
  return { frames: r.frames, order: r.order, acyclic: true };
}

/** Kahn's algorithm. The number beside a node is how many incoming edges it still has. */
export function kahn(graph: Graph, label: Label): TraverseRun {
  const r = recorder(graph);
  const n = graph.nodes.length;
  if (n === 0) {
    r.snap('No nodes.');
    return { frames: r.frames, order: [], acyclic: true };
  }
  const adj = adjacency(graph, true);
  for (let i = 0; i < n; i++) r.sub[i] = 0;
  for (const e of graph.edges) r.sub[e.b]++;
  r.snap('Count the incoming edges of every node.');
  for (let i = 0; i < n; i++) {
    if (r.sub[i] !== 0) continue;
    r.bag.push(i);
    r.nodes[i] = 'frontier';
  }
  r.snap(
    r.bag.length > 0
      ? `Nodes with no incoming edges can go first. Queue: ${names(r.bag, label)}.`
      : 'Every node has an incoming edge, so nothing can go first.',
  );
  while (r.bag.length > 0) {
    const v = r.bag.shift() as number;
    r.nodes[v] = 'current';
    r.order.push(v);
    r.snap(`Take ${label(v)} from the queue and append it to the order.`);
    for (const { to, edge } of adj[v]) {
      r.sub[to]--;
      r.edges[edge] = 'current';
      if (r.sub[to] === 0) {
        r.bag.push(to);
        r.nodes[to] = 'frontier';
        r.snap(
          `Remove ${label(v)}→${label(to)}. ${label(to)} has no incoming edges left: queue it.`,
        );
      } else {
        r.snap(`Remove ${label(v)}→${label(to)}. ${label(to)} still waits for ${r.sub[to]}.`);
      }
      r.edges[edge] = 'rejected';
    }
    r.nodes[v] = 'done';
  }
  const acyclic = r.order.length === n;
  if (acyclic) {
    r.snap(n === 0 ? 'No nodes.' : 'Done. Every edge points forward in this order.');
  } else {
    const stuck = r.nodes.flatMap((role, i) => (role === 'idle' ? [i] : []));
    for (const e of graph.edges.keys()) if (r.edges[e] === 'idle') r.edges[e] = 'cut';
    r.snap(
      `Stuck: ${names(stuck, label)} never lose all their incoming edges. They lie on a cycle or behind one, so no order exists.`,
    );
  }
  return { frames: r.frames, order: r.order, acyclic };
}

/** Depth-first topological sort: a node is placed in front of the order when it finishes. */
export function topologicalDfs(graph: Graph, label: Label): TraverseRun {
  const r = recorder(graph);
  const n = graph.nodes.length;
  const adj = adjacency(graph, true);
  let acyclic = true;
  const visit = (v: number, from: number) => {
    r.nodes[v] = 'current';
    r.bag.push(v);
    r.snap(
      from < 0
        ? `Start a search at ${label(v)}.`
        : `${label(from)}→${label(v)}: ${label(v)} is new. Go deeper.`,
    );
    for (const { to, edge } of adj[v]) {
      if (r.nodes[to] === 'idle') {
        r.edges[edge] = 'tree';
        r.nodes[v] = 'frontier';
        visit(to, v);
        r.nodes[v] = 'current';
      } else if (r.nodes[to] === 'frontier') {
        acyclic = false;
        r.edges[edge] = 'cut';
        r.snap(
          `${label(v)}→${label(to)}: ${label(to)} is still on the stack. This back edge closes a cycle.`,
        );
      } else {
        r.edges[edge] = 'current';
        r.snap(`${label(v)}→${label(to)}: ${label(to)} is finished and already placed. Skip.`);
        r.edges[edge] = 'rejected';
      }
    }
    r.nodes[v] = 'done';
    r.bag.pop();
    r.order.unshift(v);
    const top = r.bag[r.bag.length - 1];
    if (top !== undefined) r.nodes[top] = 'current';
    r.snap(`${label(v)} is finished: put it at the front of the order.`);
  };
  for (let i = 0; i < n; i++) if (r.nodes[i] === 'idle') visit(i, -1);
  r.snap(
    n === 0
      ? 'No nodes.'
      : acyclic
        ? 'Done. Reverse finishing order is a topological order: every edge points forward.'
        : 'A cycle was found, so no topological order exists. The list is only a finishing order.',
  );
  return { frames: r.frames, order: r.order, acyclic };
}
