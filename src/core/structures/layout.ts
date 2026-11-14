export interface Placed {
  /** Centre of the node, in the same units as the node widths. */
  x: number;
  depth: number;
}

export interface TreeLayout<K> {
  at: Map<K, Placed>;
  width: number;
  /** Number of levels. */
  depth: number;
}

export interface TreeShape<T, K> {
  id(node: T): K;
  /** Child slots in order. A null slot keeps a little room, so an only child still leans left or right. */
  children(node: T): readonly (T | null)[];
  /** Node width in layout units. Default 1. */
  width?(node: T): number;
  /** Space between neighbouring subtrees. Default 0.3. */
  gap?: number;
  /** Width kept for an empty child slot. Default 0.5. */
  hole?: number;
}

/**
 * A simple tidy layout: every subtree gets its own horizontal span, children
 * sit side by side and the parent is centred over them. Subtrees never
 * overlap. Positions are in abstract units; the caller scales them to fit.
 */
export function layoutTree<T, K>(root: T | null, shape: TreeShape<T, K>): TreeLayout<K> {
  const at = new Map<K, Placed>();
  if (root === null) return { at, width: 0, depth: 0 };
  const gap = shape.gap ?? 0.3;
  const hole = shape.hole ?? 0.5;
  const own = (node: T) => shape.width?.(node) ?? 1;
  const spans = new Map<T, number>();

  const kidsOf = (node: T) => {
    const kids = shape.children(node);
    return kids.some((kid) => kid !== null) ? kids : [];
  };
  const kidsSpan = (node: T): number => {
    const kids = kidsOf(node);
    let total = 0;
    kids.forEach((kid, i) => {
      total += (kid === null ? hole : measure(kid)) + (i > 0 ? gap : 0);
    });
    return total;
  };
  const measure = (node: T): number => {
    const span = Math.max(own(node), kidsSpan(node));
    spans.set(node, span);
    return span;
  };

  let depth = 0;
  const place = (node: T, left: number, level: number) => {
    depth = Math.max(depth, level + 1);
    const span = spans.get(node) ?? own(node);
    const kids = kidsOf(node);
    if (kids.length === 0) {
      at.set(shape.id(node), { x: left + span / 2, depth: level });
      return;
    }
    let cursor = left + (span - kidsSpan(node)) / 2;
    let first = 0;
    let last = 0;
    kids.forEach((kid, i) => {
      const width = kid === null ? hole : (spans.get(kid) ?? own(kid));
      let centre = cursor + width / 2;
      if (kid !== null) {
        place(kid, cursor, level + 1);
        centre = at.get(shape.id(kid))?.x ?? centre;
      }
      if (i === 0) first = centre;
      last = centre;
      cursor += width + gap;
    });
    // Keep the node inside its own span even when its children are lopsided.
    const half = own(node) / 2;
    const x = Math.max(left + half, Math.min(left + span - half, (first + last) / 2));
    at.set(shape.id(node), { x, depth: level });
  };

  const width = measure(root);
  place(root, 0, 0);
  return { at, width, depth };
}
