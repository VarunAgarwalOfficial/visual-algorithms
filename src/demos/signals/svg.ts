import { joinOutlines } from '../../core/fourier/path';
import type { Point } from '../../core/point';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shape elements and the geometry attributes that are copied from an uploaded file. */
const GEOMETRY: Record<string, readonly string[]> = {
  path: ['d'],
  polyline: ['points'],
  polygon: ['points'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
};

/** Shapes inside these are definitions, not drawn where they stand. */
const NOT_DRAWN = 'defs, symbol, clipPath, mask, pattern, marker';
/** A transform list is numbers, commas, spaces, brackets and function names only. */
const SAFE_TRANSFORM = /^[\w\s().,+-]*$/;

/** The element's own transform preceded by those of all its ancestors, outermost first. */
function transformChain(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = node.getAttribute('transform');
    if (value && SAFE_TRANSFORM.test(value)) parts.unshift(value);
  }
  return parts.join(' ');
}

/**
 * Samples every shape in an SVG document as about `count` points in total,
 * shared out by outline length, and joins them into one path. Group and shape
 * transforms are applied. The file is parsed as inert XML and never inserted
 * into the page: only whitelisted geometry attributes and transform lists are
 * copied onto fresh, hidden elements that the browser measures.
 */
export function sampleSvg(source: string, count: number): Point[] {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid SVG.');

  const host = document.createElementNS(SVG_NS, 'svg');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'absolute';
  document.body.append(host);

  try {
    const shapes: { shape: SVGGeometryElement; length: number; matrix: DOMMatrix | null }[] = [];
    for (const original of doc.querySelectorAll(Object.keys(GEOMETRY).join(','))) {
      if (original.closest(NOT_DRAWN)) continue;
      const tag = original.localName;
      const shape = document.createElementNS(SVG_NS, tag) as SVGGeometryElement;
      for (const name of GEOMETRY[tag]) {
        const value = original.getAttribute(name);
        if (value !== null) shape.setAttribute(name, value);
      }
      const chain = transformChain(original);
      if (chain) shape.setAttribute('transform', chain);
      host.append(shape);
      const length = shape.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) continue;
      const matrix = shape.transform.baseVal.consolidate()?.matrix ?? null;
      shapes.push({ shape, length, matrix });
    }
    if (shapes.length === 0) throw new Error('No path, polyline or basic shape found in that SVG.');

    // Lengths are measured before the transform; scale each by its matrix so the share is fair.
    const scaled = shapes.map(({ length, matrix }) =>
      matrix ? length * Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : length,
    );
    const total = scaled.reduce((sum, v) => sum + v, 0);

    const outlines = shapes.map(({ shape, length, matrix }, index) => {
      const n = Math.max(2, Math.round((count * scaled[index]) / total));
      const points: Point[] = [];
      for (let i = 0; i <= n; i++) {
        const p = shape.getPointAtLength((i / n) * length);
        points.push(
          matrix
            ? {
                x: matrix.a * p.x + matrix.c * p.y + matrix.e,
                y: matrix.b * p.x + matrix.d * p.y + matrix.f,
              }
            : { x: p.x, y: p.y },
        );
      }
      return points;
    });
    return joinOutlines(outlines);
  } finally {
    host.remove();
  }
}
