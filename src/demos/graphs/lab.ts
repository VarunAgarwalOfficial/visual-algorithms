import { decodeGraph, encodeGraph, type Graph } from '../../core/graphs/graph';
import { newSeed, seeded, type Random } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, el, fieldset, select } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { watchPalette, type Palette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, legend, stats, type DemoEntry } from '../layout';
import { graphEditor, graphView, type Tool, type View } from './graphview';

/**
 * The frame every node-link graph demo shares: a graph the user can edit, an
 * algorithm that turns it into a list of snapshot frames, and a player that
 * moves through them. Each demo supplies the algorithm and the drawing.
 */

type Value = string | number | boolean;
interface Named {
  id: string;
  name: string;
}

export interface Scene<F> {
  ctx: CanvasRenderingContext2D;
  palette: Palette;
  view: View;
  width: number;
  height: number;
  graph: Graph;
  frame: F;
  /** Index of the frame, and the number of the last one. */
  position: number;
  last: number;
}

export interface Lab<F> {
  graph(): Graph;
  frame(): F;
  /** The URL-backed settings: the lab's own plus the demo's `extra`. */
  settings: Record<string, Value>;
  save(): void;
  /** The graph or a setting changed: run the algorithm again. */
  rebuild(): void;
  redraw(): void;
  panel: HTMLElement;
}

export interface LabOptions<F extends { note: string }, K extends string> {
  root: HTMLElement;
  entry: DemoEntry;
  canvasLabel: string;
  directed: boolean;
  /** Nodes carry a letter (large nodes); otherwise they are small dots. */
  labelled: boolean;
  maxNodes: number;
  maxWeight: number;
  /** Pixels kept free under the graph for chips. */
  strip(height: number): number;
  algorithms: readonly Named[];
  presets: readonly Named[];
  /** Extra URL settings with their defaults. */
  extra?: Record<string, Value>;
  makePreset(id: string, random: Random): Graph;
  /** Tidies the graph after loading or editing (for example, derives the edges). */
  normalise?(graph: Graph, lab: Lab<F>): void;
  run(graph: Graph, algorithm: string, lab: Lab<F>): F[];
  draw(scene: Scene<F>, lab: Lab<F>): void;
  counters: Record<K, string>;
  count(frame: F, lab: Lab<F>): Partial<Record<K, string | number>>;
  legend: readonly (readonly [string, string])[];
  manualEdges: boolean;
  /** True when moving a node changes the result (weights from geometry). */
  geometryMatters?: boolean;
  edgeWeight?(a: number, b: number, lab: Lab<F>): number;
  locked?(node: number): boolean;
  onRemoveNode?(node: number, lab: Lab<F>): void;
  onNodeClick?(node: number, lab: Lab<F>): void;
  onEdgeClick?(edge: number, lab: Lab<F>): void;
  /** A line under the tool picker saying what a click does in this demo. */
  hint?: string;
  /** Controls placed after the graph controls. */
  controls?(lab: Lab<F>): (Node | false)[];
  /** One-line description of the chosen algorithm. */
  caption?(algorithm: string): string;
  speed?: number;
}

export function graphLab<F extends { note: string }, K extends string>(
  options: LabOptions<F, K>,
): { lab: Lab<F>; about: HTMLElement; dispose(): void } {
  const { canvas, readout, panel, about } = buildLayout(
    options.root,
    options.entry,
    options.canvasLabel,
  );
  const url = urlState<Record<string, Value>>({
    alg: options.algorithms[0].id,
    preset: options.presets[0].id,
    seed: 1,
    g: '',
    tool: 'move',
    speed: options.speed ?? 2,
    ...options.extra,
  });
  const settings = url.state;
  const pick = (list: readonly Named[], id: Value) =>
    list.find((x) => x.id === id)?.id ?? list[0].id;
  settings.alg = pick(options.algorithms, settings.alg);
  settings.preset = pick(options.presets, settings.preset);
  const tools: { id: Tool; name: string }[] = [
    { id: 'move', name: 'Move and add nodes' },
    ...(options.manualEdges ? [{ id: 'edge' as const, name: 'Draw edges' }] : []),
    { id: 'delete', name: options.manualEdges ? 'Delete nodes and edges' : 'Delete nodes' },
  ];
  const tool = (): Tool => tools.find((t) => t.id === settings.tool)?.id ?? 'move';

  let graph: Graph = { nodes: [], edges: [] };
  let frames: F[] = [];
  let position = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: Number(settings.speed) || 2,
    minSpeed: 0.25,
    maxSpeed: 60,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = Math.min(at, frames.length - 1);
      update();
    },
  });

  const view = () =>
    graphView(stage.width, stage.height, options.strip(stage.height), options.labelled);

  const lab: Lab<F> = {
    graph: () => graph,
    frame: () => frames[position],
    settings,
    save: () => url.save(),
    rebuild: () => rebuild('structure'),
    redraw: () => update(),
    panel,
  };

  function load() {
    const limits = {
      maxNodes: options.maxNodes,
      maxWeight: options.maxWeight,
      directed: options.directed,
    };
    const shared = settings.g ? decodeGraph(String(settings.g).slice(0, 20000), limits) : undefined;
    graph =
      shared ?? options.makePreset(String(settings.preset), seeded(Number(settings.seed) || 0));
    rebuild('load');
  }

  function rebuild(kind: 'load' | 'move' | 'structure') {
    const wasAtEnd = kind !== 'load' && frames.length > 1 && position >= frames.length - 1;
    options.normalise?.(graph, lab);
    frames = options.run(graph, String(settings.alg), lab);
    let at = 0;
    if (wasAtEnd) at = frames.length - 1;
    else if (kind === 'move' && !options.geometryMatters)
      at = Math.min(position, frames.length - 1);
    if (kind !== 'load') {
      // Derived edges are rebuilt on load, so only the points need saving.
      settings.g = encodeGraph(options.manualEdges ? graph : { nodes: graph.nodes, edges: [] });
    }
    caption.textContent = options.caption?.(String(settings.alg)) ?? '';
    player.setLength(frames.length - 1, at);
    url.save();
  }

  function draw() {
    const { ctx, width, height } = stage;
    ctx.clearRect(0, 0, width, height);
    const frame = frames[position];
    if (!frame) return;
    const scene: Scene<F> = {
      ctx,
      palette: theme.palette,
      view: view(),
      width,
      height,
      graph,
      frame,
      position,
      last: frames.length - 1,
    };
    options.draw(scene, lab);
    const rubber = editor.rubber();
    if (rubber && graph.nodes[rubber.from]) {
      const from = scene.view.toCanvas(graph.nodes[rubber.from]);
      ctx.strokeStyle = theme.palette.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(rubber.to.x, rubber.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function update() {
    draw();
    const frame = frames[position];
    if (!frame) return;
    counters.set(options.count(frame, lab));
    status.textContent = frame.note;
  }

  const editor = graphEditor({
    canvas,
    view,
    graph: () => graph,
    tool,
    directed: options.directed,
    maxNodes: options.maxNodes,
    manualEdges: options.manualEdges,
    edgeWeight: (a, b) => options.edgeWeight?.(a, b, lab) ?? 1,
    locked: options.locked,
    onChange: (kind) => rebuild(kind),
    onRemoveNode: (node) => options.onRemoveNode?.(node, lab),
    onNodeClick: (node) => options.onNodeClick?.(node, lab),
    onEdgeClick: options.onEdgeClick ? (edge) => options.onEdgeClick?.(edge, lab) : undefined,
    redraw: draw,
  });

  const counters = stats(options.counters);
  const status = el('p', { class: 'note', style: 'flex: 1 1 100%; min-height: 2.8em' });
  const caption = el('p', { class: 'note' });

  const presetSelect = select({
    label: 'Preset',
    options: options.presets,
    value: String(settings.preset),
    onChange(id) {
      settings.preset = id;
      settings.g = '';
      load();
    },
  });
  panel.append(
    fieldset(
      'Algorithm',
      options.algorithms.length > 1 &&
        select({
          label: 'Algorithm',
          options: options.algorithms,
          value: String(settings.alg),
          onChange(id) {
            settings.alg = id;
            rebuild('load');
          },
        }).root,
      caption,
    ),
    fieldset(
      'Graph',
      presetSelect.root,
      options.presets.some((p) => p.id === 'random') &&
        button('New random graph', () => {
          settings.preset = 'random';
          presetSelect.input.value = 'random';
          settings.seed = newSeed();
          settings.g = '';
          load();
        }),
      select({
        label: 'Pointer',
        options: tools,
        value: tool(),
        onChange(id) {
          settings.tool = id;
          url.save();
        },
      }).root,
      el('p', {
        class: 'note',
        text:
          'Drag a node to move it; click empty space to add one.' +
          (options.manualEdges
            ? ' With Draw edges, drag from one node to another; do it again to remove the edge.'
            : '') +
          (options.hint ? ` ${options.hint}` : ''),
      }),
      ...(options.controls?.(lab) ?? []),
    ),
    player.root,
  );
  readout.append(counters.root, status, legend(options.legend));

  load();

  return {
    lab,
    about,
    dispose() {
      editor.dispose();
      player.dispose();
      stage.dispose();
      theme.dispose();
    },
  };
}
