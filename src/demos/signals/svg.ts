import type { Point } from '../core/geometry';

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

/**
 * Samples the longest shape in an SVG document as `count` points along its
 * outline. The file is parsed as inert XML and never inserted into the page:
 * only whitelisted geometry attributes are copied onto a fresh, hidden element
 * that the browser measures. Transforms are ignored.
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
    let best: SVGGeometryElement | null = null;
    let bestLength = 0;
    for (const source of doc.querySelectorAll(Object.keys(GEOMETRY).join(','))) {
      const tag = source.localName;
      const shape = document.createElementNS(SVG_NS, tag) as SVGGeometryElement;
      for (const name of GEOMETRY[tag]) {
        const value = source.getAttribute(name);
        if (value !== null) shape.setAttribute(name, value);
      }
      host.append(shape);
      const length = shape.getTotalLength();
      if (Number.isFinite(length) && length > bestLength) {
        best = shape;
        bestLength = length;
      }
    }
    if (!best) throw new Error('No path, polyline or basic shape found in that SVG.');

    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
      const p = best.getPointAtLength((i / count) * bestLength);
      points.push({ x: p.x, y: p.y });
    }
    return points;
  } finally {
    host.remove();
  }
}
