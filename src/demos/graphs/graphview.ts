import {
  removeNode,
  toggleEdge,
  type Edge,
  type EdgeRole,
  type Graph,
  type NodeRole,
} from '../../core/graphs/graph';
import type { Point } from '../../core/point';
import { onDrag } from '../../ui/pointer';
import { mix, type Palette } from '../../ui/theme';
import { FONT, SMALL, labelSize } from '../../ui/font';

/** Shared drawing and editing for the node-link graph demos. */

export interface View {
  toCanvas(p: Point): Point;
  toUnit(p: Point): Point;
  /** Node radius in CSS pixels. */
  radius: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

/**
 * Maps the unit square onto the canvas, leaving `bottom` pixels free for a
 * strip of chips. `labelled` nodes are drawn large enough to hold a letter.
 */
export function graphView(width: number, height: number, bottom: number, labelled: boolean): View {
  const base = Math.min(width, height - bottom);
  const radius = labelled
    ? Math.max(9, Math.min(15, base * 0.055))
    : Math.max(3.5, Math.min(6, base * 0.02));
  const pad = labelled ? radius + 20 : radius + 8;
  const w = Math.max(1, width - 2 * pad);
  const h = Math.max(1, height - bottom - 2 * pad);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    radius,
    width,
    height,
    toCanvas: (p) => ({ x: pad + p.x * w, y: pad + p.y * h }),
    toUnit: (p) => ({ x: clamp((p.x - pad) / w), y: clamp((p.y - pad) / h) }),
  };
}

interface Curve {
  a: Point;
  b: Point;
  /** Control point of the quadratic curve; the midpoint for a straight edge. */
  c: Point;
}

/** A directed edge bends to its right when the opposite edge also exists, so the pair separates. */
function curve(view: View, graph: Graph, edge: Edge, directed: boolean): Curve {
  const a = view.toCanvas(graph.nodes[edge.a]);
  const b = view.toCanvas(graph.nodes[edge.b]);
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (directed && graph.edges.some((e) => e.a === edge.b && e.b === edge.a)) {
    const bend = 0.22;
    c.x += (b.y - a.y) * bend;
    c.y -= (b.x - a.x) * bend;
  }
  return { a, b, c };
}

function along({ a, b, c }: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

export interface EdgeStyle {
  colour: string;
  width: number;
  dashed?: boolean;
  label?: string;
  /** Defaults to the ink colour. */
  labelColour?: string;
  hidden?: boolean;
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  /** Outline width; default 1.5. */
  width?: number;
  text?: string;
  /** Small text under the node. */
  sub?: string;
}

export interface GraphStyle {
  directed: boolean;
  edge(index: number): EdgeStyle;
  node(index: number): NodeStyle;
}

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  view: View,
  graph: Graph,
  style: GraphStyle,
): void {
  const r = view.radius;
  const styles = graph.edges.map((_, i) => style.edge(i));
  // Thin edges first, so the highlighted ones lie on top.
  const order = styles.map((_, i) => i).sort((p, q) => styles[p].width - styles[q].width);
  ctx.lineCap = 'round';
  for (const i of order) {
    const s = styles[i];
    if (s.hidden) continue;
    const shape = curve(view, graph, graph.edges[i], style.directed);
    const { a, b, c } = shape;
    // Stop at the rim of the target node so the arrowhead stays visible.
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const head = style.directed ? Math.max(6, Math.min(10, r * 0.75)) : 0;
    const end = style.directed
      ? { x: b.x - ux * (r + head * 0.8), y: b.y - uy * (r + head * 0.8) }
      : b;
    ctx.strokeStyle = s.colour;
    ctx.fillStyle = s.colour;
    ctx.lineWidth = s.width;
    ctx.setLineDash(s.dashed ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (style.directed) {
      const tip = { x: b.x - ux * r, y: b.y - uy * r };
      const half = head * 0.45 + s.width * 0.4;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - ux * head - uy * half, tip.y - uy * head + ux * half);
      ctx.lineTo(tip.x - ux * head + uy * half, tip.y - uy * head - ux * half);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Labels sit on a patch of background so they stay readable where edges cross.
  ctx.font = `${SMALL}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const i of order) {
    const s = styles[i];
    if (s.hidden || !s.label) continue;
    // The patch covers the letters' ink with 3 px to spare on every side.
    const m = ctx.measureText(s.label);
    // Along the edge, at the first place where the patch clears every node by 2 px.
    const shape = curve(view, graph, graph.edges[i], style.directed);
    const clear = (p: Point) => {
      const x0 = p.x - m.actualBoundingBoxLeft - 3;
      const x1 = p.x + m.actualBoundingBoxRight + 3;
      const y0 = p.y + 0.5 - m.actualBoundingBoxAscent - 3;
      const y1 = p.y + 0.5 + m.actualBoundingBoxDescent + 3;
      return graph.nodes.every((node) => {
        const c = view.toCanvas(node);
        const dx = Math.max(x0 - c.x, 0, c.x - x1);
        const dy = Math.max(y0 - c.y, 0, c.y - y1);
        return Math.hypot(dx, dy) >= r + 2;
      });
    };
    const first = style.directed ? 0.4 : 0.5;
    const at =
      [first, 0.5, 0.45, 0.55, 0.35, 0.6, 0.3, 0.65].map((t) => along(shape, t)).find(clear) ??
      along(shape, first);
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 6;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(
      at.x - m.actualBoundingBoxLeft - 3,
      at.y + 0.5 - m.actualBoundingBoxAscent - 3,
      width,
      m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 6,
    );
    ctx.fillStyle = s.labelColour ?? palette.ink;
    ctx.fillText(s.label, at.x, at.y + 0.5);
  }

  // Directions in which edges leave each node, for placing the small notes.
  const angles: number[][] = graph.nodes.map(() => []);
  graph.edges.forEach((edge, i) => {
    if (styles[i].hidden) return;
    const { a, b, c } = curve(view, graph, edge, style.directed);
    angles[edge.a].push(Math.atan2(c.y - a.y, c.x - a.x));
    angles[edge.b].push(Math.atan2(c.y - b.y, c.x - b.x));
  });

  graph.nodes.forEach((p, i) => {
    const s = style.node(i);
    const { x, y } = view.toCanvas(p);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = s.fill;
    ctx.fill();
    ctx.lineWidth = s.width ?? 1.5;
    ctx.strokeStyle = s.stroke;
    ctx.stroke();
    if (s.text) {
      ctx.font = `600 ${labelSize(Math.round(Math.max(10, r * 0.95)))}px ${FONT}`;
      ctx.fillStyle = palette.ink;
      ctx.fillText(s.text, x, y + 0.5);
    }
    if (s.sub) {
      // Put the note on the side of the node with the most room between edges.
      ctx.font = `${SMALL}px ${FONT}`;
      const m = ctx.measureText(s.sub);
      const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 4;
      // Half the height of the letters' ink, plus 2 px, measured from the middle baseline.
      const half = Math.max(m.actualBoundingBoxAscent, m.actualBoundingBoxDescent) + 2;
      const place = (angle: number) => {
        // The corner of the note's box nearest the node keeps 4 px from its rim.
        const ex = Math.abs(Math.cos(angle)) * (width / 2);
        const ey = Math.abs(Math.sin(angle)) * half;
        const reach = r + 4 + Math.hypot(ex, ey);
        return { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach };
      };
      const fits = (angle: number) => {
        const c = place(angle);
        return (
          c.x - width / 2 >= 0 &&
          c.x + width / 2 <= view.width &&
          c.y - half >= 0 &&
          c.y + half <= view.height
        );
      };
      const c = place(freeSide(angles[i], fits));
      ctx.fillStyle = palette.bg;
      ctx.fillRect(c.x - width / 2, c.y + 0.5 - half, width, 2 * half);
      ctx.fillStyle = palette.ink;
      ctx.fillText(s.sub, c.x, c.y + 0.5);
    }
  });
}

/** The direction (below first, then other sides) that is furthest from every edge at a node and stays on the canvas. */
function freeSide(edges: readonly number[], fits: (angle: number) => boolean): number {
  const sides = [0.5, -0.5, 0, 1, 0.25, 0.75, -0.25, -0.75].map((k) => k * Math.PI);
  let best = sides[0];
  let room = -1;
  for (const side of sides) {
    if (!fits(side)) continue;
    let gap = Math.PI;
    for (const angle of edges) {
      const d = Math.abs(((angle - side + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      gap = Math.min(gap, d);
    }
    if (gap > room + 0.05) {
      room = gap;
      best = side;
    }
  }
  return best;
}

export interface Chip {
  text: string;
  fill: string;
}

/** One row of small labelled boxes: a queue, a stack, an output order. */
export function drawChips(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  box: { x: number; y: number; width: number; height: number },
  title: string,
  chips: readonly Chip[],
): void {
  ctx.font = `${SMALL}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.muted;
  const mid = box.y + box.height / 2;
  ctx.fillText(title, box.x, mid + 0.5);
  const left = box.x + ctx.measureText(title).width + 8;
  const size = Math.min(box.height - 4, (box.x + box.width - left) / Math.max(1, chips.length));
  ctx.textAlign = 'center';
  ctx.font = `600 ${labelSize(Math.max(8, Math.min(11, size * 0.6)))}px ${FONT}`;
  // Each chip is a square with a 4 px gap to the next, so its letter has room inside it.
  const side = size - 4;
  chips.forEach((chip, i) => {
    const x = left + i * size;
    ctx.fillStyle = chip.fill;
    ctx.fillRect(x, mid - side / 2, side, side);
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, mid - side / 2 + 0.5, side - 1, side - 1);
    ctx.fillStyle = palette.ink;
    // Centred on its ink: a capital sits above the middle of the em box.
    const m = ctx.measureText(chip.text);
    ctx.fillText(
      chip.text,
      x + side / 2,
      mid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
    );
  });
  if (chips.length === 0) {
    ctx.textAlign = 'left';
    ctx.font = `${SMALL}px ${FONT}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText('empty', left, mid + 0.5);
  }
}

// --- Hit testing and editing ---

export function hitNode(view: View, graph: Graph, at: Point): number {
  let best = -1;
  // A finger needs a bigger target than the drawn node.
  let reach = Math.max(view.radius + 6, 18);
  graph.nodes.forEach((p, i) => {
    const c = view.toCanvas(p);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d < reach) {
      reach = d;
      best = i;
    }
  });
  return best;
}

export function hitEdge(view: View, graph: Graph, at: Point, directed: boolean): number {
  let best = -1;
  let reach = 9;
  graph.edges.forEach((edge, i) => {
    const shape = curve(view, graph, edge, directed);
    for (let k = 1; k < 24; k++) {
      const p = along(shape, k / 24);
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d < reach) {
        reach = d;
        best = i;
      }
    }
  });
  return best;
}

export type Tool = 'move' | 'edge' | 'delete';

export interface EditorOptions {
  canvas: HTMLCanvasElement;
  view(): View;
  graph(): Graph;
  tool(): Tool;
  directed: boolean;
  maxNodes: number;
  /** False when the demo derives the edges itself; the edge tool and edge deletion are then off. */
  manualEdges: boolean;
  /** Weight given to an edge drawn by hand. */
  edgeWeight?(a: number, b: number): number;
  /** Nodes that cannot be deleted. */
  locked?(node: number): boolean;
  /** The graph was edited. 'move' means only positions changed. */
  onChange(kind: 'move' | 'structure'): void;
  /** Called just before a node is removed and later nodes shift down. */
  onRemoveNode?(node: number): void;
  onNodeClick?(node: number): void;
  onEdgeClick?(edge: number): void;
  /** The rubber band moved: repaint. */
  redraw(): void;
}

export interface Editor {
  /** The edge being drawn, from a node to the pointer, if any. */
  rubber(): { from: number; to: Point } | undefined;
  dispose(): void;
}

/**
 * Pointer editing shared by the graph demos. Move tool: drag a node, click
 * empty space to add one. Edge tool: drag from node to node to add or remove
 * an edge. Delete tool: click a node or an edge.
 */
export function graphEditor(options: EditorOptions): Editor {
  let node = -1;
  let edge = -1;
  let origin: Point = { x: 0, y: 0 };
  let moved = false;
  let rubber: { from: number; to: Point } | undefined;

  const dispose = onDrag(options.canvas, {
    down(p) {
      const graph = options.graph();
      const view = options.view();
      origin = p;
      moved = false;
      node = hitNode(view, graph, p);
      // Edges only catch the pointer when a click on one does something.
      const edgesMatter =
        options.manualEdges && (options.tool() === 'delete' || options.onEdgeClick !== undefined);
      edge = node < 0 && edgesMatter ? hitEdge(view, graph, p, options.directed) : -1;
      if (options.tool() === 'delete') {
        if (node >= 0 && !options.locked?.(node)) {
          options.onRemoveNode?.(node);
          removeNode(graph, node);
          options.onChange('structure');
        } else if (node < 0 && edge >= 0 && options.manualEdges) {
          graph.edges.splice(edge, 1);
          options.onChange('structure');
        }
        return false;
      }
      if (node >= 0 && options.tool() === 'edge' && options.manualEdges) {
        rubber = { from: node, to: p };
      }
      return true;
    },
    move(p) {
      if (!moved && Math.hypot(p.x - origin.x, p.y - origin.y) < 4) return;
      moved = true;
      if (rubber) {
        rubber.to = p;
        options.redraw();
      } else if (node >= 0) {
        options.graph().nodes[node] = options.view().toUnit(p);
        options.onChange('move');
      }
    },
    up(p) {
      const graph = options.graph();
      const view = options.view();
      if (rubber) {
        const target = hitNode(view, graph, p);
        const from = rubber.from;
        rubber = undefined;
        if (target >= 0 && target !== from) {
          const weight = options.edgeWeight?.(from, target) ?? 1;
          // Drawing over an existing edge removes it.
          toggleEdge(graph, from, target, options.directed, weight);
          options.onChange('structure');
        } else {
          if (!moved) options.onNodeClick?.(from);
          options.redraw();
        }
        return;
      }
      if (moved) return;
      if (node >= 0) options.onNodeClick?.(node);
      else if (edge >= 0) options.onEdgeClick?.(edge);
      else if (graph.nodes.length < options.maxNodes) {
        graph.nodes.push(view.toUnit(p));
        options.onChange('structure');
      }
    },
  });

  return { rubber: () => rubber, dispose };
}

// --- The common colour code ---

export function tint(colour: string, palette: Palette, amount = 0.6): string {
  return mix(colour, palette.bg, amount);
}

export function roleEdge(role: EdgeRole, palette: Palette): EdgeStyle {
  if (role === 'tree') return { colour: palette.accent, width: 3 };
  if (role === 'current') return { colour: palette.change, width: 3.5 };
  if (role === 'candidate') return { colour: palette.compare, width: 2.5 };
  if (role === 'cut') return { colour: palette.change, width: 3, dashed: true };
  if (role === 'rejected') return { colour: palette.faint, width: 1.5 };
  return { colour: palette.muted, width: 1.5 };
}

export function roleNode(role: NodeRole, palette: Palette): NodeStyle {
  if (role === 'current')
    return { fill: tint(palette.change, palette), stroke: palette.change, width: 3 };
  if (role === 'frontier')
    return { fill: tint(palette.compare, palette), stroke: palette.compare, width: 2 };
  if (role === 'done') return { fill: palette.visit, stroke: palette.muted };
  return { fill: palette.bg, stroke: palette.muted };
}

/** Legend entries matching roleNode and roleEdge. */
export const SWATCH = {
  current: 'var(--canvas-change)',
  frontier: 'var(--canvas-compare)',
  done: 'var(--canvas-visit)',
  tree: 'var(--canvas-accent)',
  skipped: 'var(--canvas-faint)',
} as const;
