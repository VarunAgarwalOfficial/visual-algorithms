import type { Point } from '../point';
import { dist2 } from './plane';

/** A bucket (point-region) quadtree: a leaf splits in four when it holds more than `capacity` points. */
export interface QuadNode {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Point indices; only leaves hold points. */
  points: number[];
  children?: QuadNode[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cells stop splitting at this depth so near-coincident points cannot recurse without end. */
export const MAX_DEPTH = 9;

export interface InsertInfo {
  /** Depth of the leaf the point ended up in. */
  depth: number;
  /** How many cells split to make room. */
  splits: number;
}

export function emptyTree(box: Rect): QuadNode {
  return { ...box, depth: 0, points: [] };
}

export function insert(
  root: QuadNode,
  points: readonly Point[],
  index: number,
  capacity: number,
): InsertInfo {
  let splits = 0;
  const childFor = (node: QuadNode, p: Point): QuadNode => {
    const right = p.x >= node.x + node.w / 2 ? 1 : 0;
    const lower = p.y >= node.y + node.h / 2 ? 2 : 0;
    return (node.children as QuadNode[])[right + lower];
  };
  const add = (node: QuadNode, i: number): number => {
    if (node.children) return add(childFor(node, points[i]), i);
    node.points.push(i);
    if (node.points.length <= capacity || node.depth >= MAX_DEPTH) return node.depth;
    splits++;
    const w = node.w / 2;
    const h = node.h / 2;
    node.children = [0, 1, 2, 3].map((k) => ({
      x: node.x + (k & 1) * w,
      y: node.y + (k >> 1) * h,
      w,
      h,
      depth: node.depth + 1,
      points: [],
    }));
    const moved = node.points;
    node.points = [];
    let depth = node.depth + 1;
    for (const m of moved) {
      const landed = add(childFor(node, points[m]), m);
      if (m === i) depth = landed;
    }
    return depth;
  };
  const depth = add(root, index);
  return { depth, splits };
}

/** Builds a tree from the first `count` points, inserted in order. */
export function buildQuadtree(
  points: readonly Point[],
  count: number,
  capacity: number,
  box: Rect,
): { root: QuadNode; last?: InsertInfo } {
  const root = emptyTree(box);
  let last: InsertInfo | undefined;
  for (let i = 0; i < Math.min(count, points.length); i++) last = insert(root, points, i, capacity);
  return { root, last };
}

export function treeSize(root: QuadNode): { nodes: number; leaves: number; depth: number } {
  const size = { nodes: 0, leaves: 0, depth: 0 };
  const walk = (node: QuadNode) => {
    size.nodes++;
    size.depth = Math.max(size.depth, node.depth);
    if (node.children) node.children.forEach(walk);
    else size.leaves++;
  };
  walk(root);
  return size;
}

/** What a query did, in order. */
export type QueryEvent =
  | { kind: 'visit'; node: QuadNode }
  | { kind: 'prune'; node: QuadNode }
  | { kind: 'check'; node: QuadNode; point: number; hit: boolean };

const overlaps = (node: QuadNode, r: Rect) =>
  node.x <= r.x + r.w && node.x + node.w >= r.x && node.y <= r.y + r.h && node.y + node.h >= r.y;

/** Indices of the points inside the rectangle (edges included). */
export function rangeQuery(
  root: QuadNode,
  points: readonly Point[],
  rect: Rect,
  events?: QueryEvent[],
): number[] {
  const found: number[] = [];
  const walk = (node: QuadNode) => {
    if (!overlaps(node, rect)) {
      events?.push({ kind: 'prune', node });
      return;
    }
    events?.push({ kind: 'visit', node });
    if (node.children) {
      node.children.forEach(walk);
      return;
    }
    for (const i of node.points) {
      const p = points[i];
      const hit =
        p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
      events?.push({ kind: 'check', node, point: i, hit });
      if (hit) found.push(i);
    }
  };
  walk(root);
  return found;
}

/** Squared distance from a point to the nearest part of a cell (0 inside). */
export function cellDistance2(node: Rect, p: Point): number {
  const dx = Math.max(node.x - p.x, 0, p.x - node.x - node.w);
  const dy = Math.max(node.y - p.y, 0, p.y - node.y - node.h);
  return dx * dx + dy * dy;
}

/** Index of the point nearest the probe, or -1 for an empty tree. Nearer cells are searched first. */
export function nearestQuery(
  root: QuadNode,
  points: readonly Point[],
  probe: Point,
  events?: QueryEvent[],
): number {
  let best = -1;
  let bestD2 = Infinity;
  const walk = (node: QuadNode) => {
    if (cellDistance2(node, probe) >= bestD2) {
      events?.push({ kind: 'prune', node });
      return;
    }
    events?.push({ kind: 'visit', node });
    if (node.children) {
      [...node.children]
        .sort((a, b) => cellDistance2(a, probe) - cellDistance2(b, probe))
        .forEach(walk);
      return;
    }
    for (const i of node.points) {
      const d2 = dist2(points[i], probe);
      const hit = d2 < bestD2;
      if (hit) {
        best = i;
        bestD2 = d2;
      }
      events?.push({ kind: 'check', node, point: i, hit });
    }
  };
  walk(root);
  return best;
}
