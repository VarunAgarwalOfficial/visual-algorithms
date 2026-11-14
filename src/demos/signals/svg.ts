import { joinOutlines } from '../../core/fourier/path';
import type { Point } from '../../core/point';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Shape elements and the lengths read from an uploaded file. Each length is
 * tagged with the viewport side a percentage refers to: x (width), y (height)
 * or r (the normalised diagonal).
 */
const LENGTHS: Record<string, Record<string, 'x' | 'y' | 'r'>> = {
  path: {},
  polyline: {},
  polygon: {},
  circle: { cx: 'x', cy: 'y', r: 'r' },
  ellipse: { cx: 'x', cy: 'y', rx: 'x', ry: 'y' },
  rect: { x: 'x', y: 'y', width: 'x', height: 'y', rx: 'x', ry: 'y' },
  line: { x1: 'x', y1: 'y', x2: 'x', y2: 'y' },
};
/** Shape data copied as text. Both are plain lists of numbers and path letters. */
const DATA: Record<string, string> = { path: 'd', polyline: 'points', polygon: 'points' };

/** Elements whose children are drawn. Anything else (defs, clipPath, text, ...) is skipped. */
const CONTAINERS = new Set(['g', 'a', 'switch']);
/** A transform list is numbers, commas, spaces, brackets and function names only. */
const SAFE_TRANSFORM = /^[\w\s().,+-]*$/;
/** CSS pixels per unit, at 96 dpi. */
const UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
  em: 16,
  ex: 8,
};
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const LENGTH = new RegExp(`^\\s*(${NUMBER.source})\\s*(%|[a-z]*)\\s*$`, 'i');
/** The move that opens a subpath: "M x y" or "m dx dy". */
const MOVE = new RegExp(`^[Mm][\\s,]*(${NUMBER.source})[\\s,]*(${NUMBER.source})[\\s,]*`);
/** Elements one file may draw, counting each `<use>` copy. Stops files that multiply themselves. */
const MAX_ELEMENTS = 100_000;
/** Separate outlines one file may hold. Joining them costs time quadratic in this. */
const MAX_OUTLINES = 8000;

/** What an element inherits from its ancestors. */
interface Frame {
  /** Maps the element's coordinates to those of the root. */
  matrix: DOMMatrix;
  /** Viewport size that percentages refer to. */
  width: number;
  height: number;
  visible: boolean;
}
interface Outline {
  shape: SVGGeometryElement;
  length: number;
  matrix: DOMMatrix;
}

/** A length in user units, or null when absent or unreadable (such as "auto"). */
function toLength(value: string | null, basis: number): number | null {
  const match = value === null ? null : LENGTH.exec(value);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  if (unit === '%') return (Number(match[1]) * basis) / 100;
  return unit in UNITS ? Number(match[1]) * UNITS[unit] : null;
}

/** A style property from the `style` attribute or, failing that, the presentation attribute. */
function styleOf(element: Element, name: string): string | undefined {
  const inline = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\w-]+)`, 'i').exec(
    element.getAttribute('style') ?? '',
  );
  return (inline?.[1] ?? element.getAttribute(name) ?? undefined)?.trim().toLowerCase();
}

/** Position and size of an `<svg>` or `<symbol>`, with its viewBox scaled to fit. */
function viewport(element: Element, frame: Frame, isRoot: boolean, size: Element): Frame {
  const width = toLength(size.getAttribute('width'), frame.width) ?? frame.width;
  const height = toLength(size.getAttribute('height'), frame.height) ?? frame.height;
  let matrix = frame.matrix;
  if (!isRoot) {
    matrix = matrix.translate(
      toLength(element.getAttribute('x'), frame.width) ?? 0,
      toLength(element.getAttribute('y'), frame.height) ?? 0,
    );
  }
  const box = (element.getAttribute('viewBox') ?? '').match(new RegExp(NUMBER, 'g'))?.map(Number);
  if (box?.length !== 4 || !(box[2] > 0) || !(box[3] > 0)) {
    return { ...frame, matrix, width, height };
  }
  const fit = (element.getAttribute('preserveAspectRatio') ?? '').trim();
  let sx = width / box[2];
  let sy = height / box[3];
  if (!fit.startsWith('none'))
    sx = sy = fit.endsWith('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
  const align = (axis: string) =>
    fit.includes(`${axis}Min`) ? 0 : fit.includes(`${axis}Max`) ? 1 : 0.5;
  matrix = matrix
    .translate((width - box[2] * sx) * align('x'), (height - box[3] * sy) * align('Y'))
    .scale(sx, sy)
    .translate(-box[0], -box[1]);
  return { ...frame, matrix, width: box[2], height: box[3] };
}

/**
 * Samples every visible shape in an SVG document as about `count` points in
 * total, shared out by outline length, and joins them into one path. Handles
 * transforms, viewBox, nested `<svg>`, `<use>` of local ids, unit and
 * percentage lengths, and `display`/`visibility` set on an element. Style
 * sheets, text, images and clipping are ignored.
 *
 * The file is parsed as inert XML and never inserted into the page. Lengths are
 * re-read as numbers, path data and point lists are copied as text onto fresh
 * hidden elements that the browser measures, and transform lists made only of
 * safe characters are turned into matrices. Nothing else leaves the parsed file.
 */
export function sampleSvg(source: string, count: number): Point[] {
  if (!source.trim()) throw new Error('That file is empty.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid SVG.');
  if (root.localName !== 'svg') throw new Error('That file is not an SVG.');

  const host = document.createElementNS(SVG_NS, 'svg');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'absolute';
  document.body.append(host);
  const scratch = document.createElementNS(SVG_NS, 'g');

  const outlines: Outline[] = [];
  /** Targets of the `<use>` elements being expanded; one that points back into them is a loop. */
  const using = new Set<Element>();
  let visited = 0;

  function transformOf(element: Element): DOMMatrix {
    const value = element.getAttribute('transform');
    if (!value || !SAFE_TRANSFORM.test(value)) return new DOMMatrix();
    scratch.setAttribute('transform', value);
    const m = scratch.transform.baseVal.consolidate()?.matrix;
    return m ? new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]) : new DOMMatrix();
  }

  /** Measures one fresh shape. Returns it so a path can read where its pen ended. */
  function measure(tag: string, attributes: Record<string, string>, matrix: DOMMatrix) {
    const shape = document.createElementNS(SVG_NS, tag) as SVGGeometryElement;
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    host.append(shape);
    const length = shape.getTotalLength();
    if (Number.isFinite(length) && length > 0) {
      if (outlines.length >= MAX_OUTLINES) {
        throw new Error(`That SVG has more than ${MAX_OUTLINES} separate outlines.`);
      }
      outlines.push({ shape, length, matrix });
    } else {
      shape.remove();
    }
    return { shape, length };
  }

  function addShape(element: Element, frame: Frame) {
    const tag = element.localName;
    const sides = {
      x: frame.width,
      y: frame.height,
      r: Math.hypot(frame.width, frame.height) / Math.SQRT2,
    };
    const attributes: Record<string, string> = {};
    for (const [name, side] of Object.entries(LENGTHS[tag])) {
      const value = toLength(element.getAttribute(name), sides[side]);
      if (value !== null) attributes[name] = String(value);
    }
    if (tag !== 'path') {
      const data = element.getAttribute(DATA[tag]);
      if (data !== null) attributes[DATA[tag]] = data;
      measure(tag, attributes, frame.matrix);
      return;
    }
    // Each subpath becomes its own outline, so the pen can enter it at the nearest point.
    // A relative "m" is rewritten as an absolute one, from where the last subpath left the pen.
    let pen = { x: 0, y: 0 };
    for (const piece of (element.getAttribute('d') ?? '').match(/[Mm][^Mm]*/g) ?? []) {
      const move = MOVE.exec(piece);
      if (!move) break; // Broken path data: keep what came before it, as browsers do.
      const relative = piece[0] === 'm';
      const start = {
        x: Number(move[1]) + (relative ? pen.x : 0),
        y: Number(move[2]) + (relative ? pen.y : 0),
      };
      // Bare coordinate pairs after a move are lines, relative ones after "m".
      const rest = piece.slice(move[0].length);
      const d = `M${start.x} ${start.y}${relative && /^[\d.+-]/.test(rest) ? 'l' : ''}${rest}`;
      const { shape, length } = measure('path', { d }, frame.matrix);
      const open = length > 0 && !/[Zz]\s*$/.test(piece);
      pen = open ? shape.getPointAtLength(length) : start;
    }
  }

  function walk(element: Element, inherited: Frame, used?: Element) {
    if (++visited > MAX_ELEMENTS) throw new Error('That SVG repeats its shapes too many times.');
    const tag = element.localName;
    if (styleOf(element, 'display') === 'none') return;
    const visibility = styleOf(element, 'visibility');
    let frame: Frame = {
      ...inherited,
      matrix: inherited.matrix.multiply(transformOf(element)),
      visible:
        !visibility || visibility === 'inherit' ? inherited.visible : visibility === 'visible',
    };

    if (tag in LENGTHS) {
      if (frame.visible) addShape(element, frame);
    } else if (tag === 'use') {
      const href = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href') ?? '';
      const target = href.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
      if (!target || using.has(target)) return;
      frame.matrix = frame.matrix.translate(
        toLength(element.getAttribute('x'), frame.width) ?? 0,
        toLength(element.getAttribute('y'), frame.height) ?? 0,
      );
      using.add(target);
      walk(target, frame, element);
      using.delete(target);
    } else if (tag === 'svg' || (tag === 'symbol' && used)) {
      // A <use> may give the size of the <svg> or <symbol> it points at.
      const sized = used?.hasAttribute('width') || used?.hasAttribute('height') ? used : element;
      frame = viewport(element, frame, element === root, sized);
      for (const child of element.children) walk(child, frame);
    } else if (CONTAINERS.has(tag)) {
      for (const child of element.children) walk(child, frame);
    }
  }

  try {
    // Percentages on the root refer to its viewBox when it has one, else to the default size.
    const box = (root.getAttribute('viewBox') ?? '').match(new RegExp(NUMBER, 'g'))?.map(Number);
    const sized = box?.length === 4 && box[2] > 0 && box[3] > 0;
    walk(root, {
      matrix: new DOMMatrix(),
      width: sized ? box[2] : 300,
      height: sized ? box[3] : 150,
      visible: true,
    });
    if (outlines.length === 0) throw new Error('That SVG has no visible shapes to trace.');

    // Lengths are measured before the transform; scale each by its matrix so the share is fair.
    const scaled = outlines.map(
      ({ length, matrix: m }) => length * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
    );
    const total = scaled.reduce((sum, v) => sum + v, 0);
    if (!(total > 0)) throw new Error('That SVG has no visible shapes to trace.');

    return joinOutlines(
      outlines.map(({ shape, length, matrix: m }, index) => {
        const n = Math.max(2, Math.round((count * scaled[index]) / total));
        const points: Point[] = [];
        for (let i = 0; i <= n; i++) {
          const p = shape.getPointAtLength((i / n) * length);
          points.push({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
        }
        return points;
      }),
    );
  } finally {
    host.remove();
  }
}
