import type { Graph, Label } from './graph';

export interface FlowFrame {
  note: string;
  /** Flow on each edge. */
  flow: number[];
  /** Nodes the current breadth-first search has reached in the residual graph. */
  reach: boolean[];
  /** The augmenting path as edges; `forward` false means flow is pushed back along the edge. */
  path: { edge: number; forward: boolean }[];
  bottleneck: number;
  total: number;
  paths: number;
  /** Final frame only: the saturated edges leaving the source side. */
  cut: number[];
  /** True on the final frame, when no augmenting path is left. */
  done: boolean;
}

export interface FlowRun {
  frames: FlowFrame[];
  flow: number[];
  total: number;
  /** Edges from the source side to the sink side of the minimum cut. */
  cut: number[];
  /** True for nodes on the source side of the minimum cut. */
  sourceSide: boolean[];
}

/**
 * Edmonds-Karp: repeatedly find a shortest path with spare capacity (breadth-first
 * search in the residual graph) and push as much flow along it as it can take.
 */
export function edmondsKarp(graph: Graph, source: number, sink: number, label: Label): FlowRun {
  const n = graph.nodes.length;
  const flow: number[] = graph.edges.map(() => 0);
  const frames: FlowFrame[] = [];
  let total = 0;
  let paths = 0;
  let reach: boolean[] = graph.nodes.map(() => false);
  let path: FlowFrame['path'] = [];
  let bottleneck = 0;
  let cut: number[] = [];
  let done = false;
  const snap = (note: string) =>
    frames.push({
      note,
      flow: [...flow],
      reach: [...reach],
      path: [...path],
      bottleneck,
      total,
      paths,
      cut,
      done,
    });
  const spare = (edge: number, forward: boolean) =>
    forward ? graph.edges[edge].w - flow[edge] : flow[edge];
  const names = (list: readonly number[]) => list.map(label).join(', ');

  if (source >= n || sink >= n || source === sink) {
    snap('The network needs a source and a sink.');
    return { frames, flow, total, cut, sourceSide: reach };
  }
  snap(
    `All flows start at 0. Look for a path from ${label(source)} to ${label(sink)} with spare capacity.`,
  );

  for (;;) {
    // Breadth-first search in the residual graph, one level per frame.
    reach = graph.nodes.map(() => false);
    path = [];
    bottleneck = 0;
    const via: ({ edge: number; forward: boolean; from: number } | undefined)[] = [];
    reach[source] = true;
    let level = [source];
    while (level.length > 0 && !reach[sink]) {
      const next: number[] = [];
      for (const v of level) {
        graph.edges.forEach((e, edge) => {
          for (const forward of [true, false]) {
            const [from, to] = forward ? [e.a, e.b] : [e.b, e.a];
            if (from !== v || reach[to] || spare(edge, forward) <= 0) continue;
            reach[to] = true;
            via[to] = { edge, forward, from };
            next.push(to);
          }
        });
      }
      level = next;
      if (next.length > 0 && !reach[sink]) {
        snap(
          `Search outwards from ${label(source)} along edges with spare capacity: reached ${names(next)}.`,
        );
      }
    }
    if (!reach[sink]) break;

    const nodes = [sink];
    for (let v = sink; v !== source;) {
      const step = via[v];
      if (!step) break;
      path.unshift({ edge: step.edge, forward: step.forward });
      v = step.from;
      nodes.unshift(v);
    }
    bottleneck = Math.min(...path.map((p) => spare(p.edge, p.forward)));
    const tight = path.find((p) => spare(p.edge, p.forward) === bottleneck);
    const undo = path.filter((p) => !p.forward);
    const tightEdge = tight ? graph.edges[tight.edge] : undefined;
    snap(
      `Shortest path with spare capacity: ${nodes.map(label).join(' → ')}. Its bottleneck is ${bottleneck}` +
        (tightEdge ? ` (edge ${label(tightEdge.a)}→${label(tightEdge.b)}).` : '.') +
        (undo.length > 0
          ? ` It runs against ${undo.map((p) => `${label(graph.edges[p.edge].a)}→${label(graph.edges[p.edge].b)}`).join(', ')}, which takes flow back off that edge.`
          : ''),
    );
    for (const p of path) flow[p.edge] += p.forward ? bottleneck : -bottleneck;
    total += bottleneck;
    paths++;
    snap(`Push ${bottleneck} along the path. Total flow is now ${total}.`);
  }

  cut = graph.edges.flatMap((e, i) => (reach[e.a] && !reach[e.b] ? [i] : []));
  const capacity = cut.reduce((sum, i) => sum + graph.edges[i].w, 0);
  done = true;
  const side = reach.flatMap((r, i) => (r ? [i] : []));
  snap(
    `No path is left. The search reaches only ${names(side)}; every edge leaving that set is full. Their capacities add up to ${capacity}, the same as the flow ${total}: a minimum cut.`,
  );
  return { frames, flow, total, cut, sourceSide: reach };
}
