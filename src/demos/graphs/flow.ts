import { edmondsKarp, type FlowFrame } from '../../core/graphs/flow';
import {
  FLOW_PRESETS,
  flowPreset,
  letter,
  type Edge,
  type Graph,
  type Label,
} from '../../core/graphs/graph';
import { checkbox, el, slider } from '../../ui/dom';
import { formula, prose, type Mount } from '../layout';
import { drawGraph, tint, type EdgeStyle } from './graphview';
import { graphLab, type Lab } from './lab';

const MAX_CAPACITY = 30;
/** Node 0 is the source and node 1 the sink; the rest are lettered. */
const label: Label = (i) => (i === 0 ? 's' : i === 1 ? 't' : letter(i - 2));

export const mount: Mount = (root, entry) => {
  let selected = -1;
  let picked: Edge | undefined;
  const edgeName = (graph: Graph, i: number) =>
    `${label(graph.edges[i].a)}→${label(graph.edges[i].b)}`;

  const capacity = slider({
    label: 'Capacity',
    min: 1,
    max: MAX_CAPACITY,
    value: 1,
    onInput(value) {
      const edge = handle.lab.graph().edges[selected];
      if (!edge) return;
      edge.w = value;
      handle.lab.rebuild();
    },
  });
  const selection = el('p', { class: 'note' });
  function select(edge: number, lab: Lab<FlowFrame>) {
    const graph = lab.graph();
    selected = edge >= 0 && edge < graph.edges.length ? edge : -1;
    picked = graph.edges[selected];
    capacity.root.hidden = selected < 0;
    if (selected >= 0) capacity.set(graph.edges[selected].w);
    selection.textContent =
      selected < 0
        ? 'Click an edge to change its capacity.'
        : `Edge ${edgeName(graph, selected)} is selected.`;
  }

  const handle = graphLab<FlowFrame, 'flow' | 'paths' | 'bottleneck' | 'cut'>({
    root,
    entry,
    canvasLabel:
      'A directed network from a source s to a sink t. Each edge shows its flow and capacity; the current augmenting path is highlighted.',
    directed: true,
    labelled: true,
    maxNodes: 14,
    maxWeight: MAX_CAPACITY,
    strip: () => 0,
    algorithms: [{ id: 'ek', name: 'Edmonds-Karp' }],
    presets: FLOW_PRESETS,
    extra: { residual: false },
    makePreset: flowPreset,
    manualEdges: true,
    edgeWeight: () => 5,
    locked: (node) => node < 2,
    caption: () =>
      'Ford-Fulkerson with breadth-first search: always augment along a path with the fewest edges.',
    run(graph, _algorithm, lab) {
      // Editing can shift or remove the selected edge: follow it by identity.
      select(picked ? graph.edges.indexOf(picked) : -1, lab);
      return edmondsKarp(graph, 0, 1, label).frames;
    },
    onEdgeClick(edge, lab) {
      select(edge, lab);
      lab.redraw();
    },
    onRemoveNode() {
      selected = -1;
      picked = undefined;
    },
    controls: (lab) => [
      selection,
      capacity.root,
      checkbox({
        label: 'Show the residual graph',
        checked: Boolean(lab.settings.residual),
        onChange(checked) {
          lab.settings.residual = checked;
          lab.save();
          lab.redraw();
        },
      }),
    ],
    counters: {
      flow: 'Total flow',
      paths: 'Augmenting paths',
      bottleneck: 'Bottleneck',
      cut: 'Cut capacity',
    },
    count: (frame, lab) => ({
      flow: frame.total,
      paths: frame.paths,
      bottleneck: frame.path.length > 0 ? frame.bottleneck : '–',
      cut: frame.done ? frame.cut.reduce((sum, i) => sum + lab.graph().edges[i].w, 0) : '–',
    }),
    legend: [
      ['var(--canvas-change)', 'Augmenting path'],
      ['var(--canvas-accent)', 'Carries flow'],
      ['var(--canvas-ink)', 'Full'],
      ['var(--canvas-visit)', 'Reached by the search'],
      ['var(--canvas-compare)', 'Minimum cut'],
    ],
    draw({ ctx, palette, view, graph, frame }, lab) {
      const onPath = new Map(frame.path.map((p) => [p.edge, p.forward]));
      const final = frame.done;
      const node = (i: number) => ({
        fill: frame.reach[i] ? palette.visit : palette.bg,
        stroke: i < 2 ? palette.accent : palette.muted,
        width: i < 2 ? 3 : 1.5,
        text: label(i),
      });
      if (lab.settings.residual) {
        // One arc per direction: spare capacity forwards plus flow that can be undone.
        const arcs: { a: number; b: number; w: number; hot: boolean }[] = [];
        const add = (a: number, b: number, w: number, hot: boolean) => {
          if (w <= 0) return;
          const arc = arcs.find((x) => x.a === a && x.b === b);
          if (arc) {
            arc.w += w;
            arc.hot ||= hot;
          } else arcs.push({ a, b, w, hot });
        };
        graph.edges.forEach((e, i) => {
          add(e.a, e.b, e.w - frame.flow[i], onPath.get(i) === true);
          add(e.b, e.a, frame.flow[i], onPath.get(i) === false);
        });
        drawGraph(
          ctx,
          palette,
          view,
          { nodes: graph.nodes, edges: arcs },
          {
            directed: true,
            edge: (i) => ({
              colour: arcs[i].hot ? palette.change : palette.muted,
              width: arcs[i].hot ? 3.5 : 1.5,
              label: String(arcs[i].w),
            }),
            node,
          },
        );
        return;
      }
      drawGraph(ctx, palette, view, graph, {
        directed: true,
        edge(i): EdgeStyle {
          const e = graph.edges[i];
          const text = `${frame.flow[i]}/${e.w}`;
          const labelColour = i === selected ? palette.accent : undefined;
          const base = { label: i === selected ? `[${text}]` : text, labelColour };
          if (final && frame.cut.includes(i)) return { ...base, colour: palette.compare, width: 4 };
          if (onPath.has(i)) {
            return { ...base, colour: palette.change, width: 3.5, dashed: onPath.get(i) === false };
          }
          if (frame.flow[i] === e.w) return { ...base, colour: palette.ink, width: 2.5 };
          if (frame.flow[i] > 0) return { ...base, colour: palette.accent, width: 2.5 };
          return { ...base, colour: palette.muted, width: 1.5 };
        },
        node: (i) =>
          final && frame.reach[i]
            ? { ...node(i), fill: tint(palette.compare, palette, 0.55) }
            : node(i),
      });
    },
  });
  select(-1, handle.lab);

  handle.about.append(
    prose(
      'Each edge can carry flow up to its capacity, and at every node except the source `s` and the sink `t`, what flows in must flow out. The question is how much can travel from `s` to `t` in total. Edge labels read flow/capacity.',
    ),
    prose(
      'The method is to find a path from `s` to `t` on which every edge has room, push as much as its tightest edge allows (the bottleneck), and repeat. The search runs in the residual graph, which has an arc `u→v` for spare capacity and an arc `v→u` for flow already sent that could be taken back. Taking flow back is what lets an early poor choice be undone: the bipartite matching preset needs it. Tick the residual box to see those arcs.',
    ),
    formula(
      'residual(u→v) = capacity(u→v) − flow(u→v) + flow(v→u)\nmax flow from s to t  =  min capacity of a cut separating s from t',
    ),
    prose(
      'When no path is left, the nodes the search can still reach form one side of a cut. Every edge leaving that side is full and every edge entering it is empty, so the flow across the cut equals its capacity. No flow can exceed any cut, so this flow is the largest possible and this cut the smallest. Choosing the shortest path each time (Edmonds-Karp) bounds the work at `O(V·E²)`.',
    ),
    prose(
      'Click an edge to select it and change its capacity. New edges get capacity 5. The source and sink cannot be deleted.',
    ),
  );
  return handle.dispose;
};
