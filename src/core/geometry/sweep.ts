import type { Point } from '../point';

/**
 * Bentley-Ottmann sweep for segment intersections, in the event-point form of
 * de Berg et al.: a vertical line sweeps left to right (ties broken top to
 * bottom on screen, by smaller y). At each event point the segments that end
 * there or pass through it are taken out of the status, and those that start
 * there or pass through it are put back in their order just past the point.
 * Only segments that become neighbours in the status are tested.
 *
 * Handled: vertical segments, shared endpoints, an endpoint lying on another
 * segment, several segments through one point. Not reported: parallel pairs,
 * so collinear segments that overlap or touch end to end are ignored.
 * Coordinates are compared with a small tolerance.
 */
export interface Segment {
  a: Point;
  b: Point;
}

export interface Crossing {
  p: Point;
  /** The segments that meet here. */
  segments: number[];
}

export interface SweepStep {
  kind: 'event' | 'test' | 'done';
  /** The sweep position. */
  p: Point;
  /** Status after this step, in order of increasing y on screen (top to bottom). */
  status: number[];
  /** Event points still in the queue. */
  queue: Point[];
  /** For 'test': the pair tested and where they meet, if they do. */
  pair?: [number, number];
  hit?: Point;
  /** Crossings reported so far (count into the result's list). */
  found: number;
  pairs: number;
  tests: number;
  note: string;
}

export interface SweepResult {
  crossings: Crossing[];
  /** Intersecting pairs [i, j] with i < j. */
  pairs: [number, number][];
  tests: number;
  steps: SweepStep[];
}

const EPS = 1e-7;

const compare = (p: Point, q: Point): number =>
  Math.abs(p.x - q.x) > EPS ? p.x - q.x : Math.abs(p.y - q.y) > EPS ? p.y - q.y : 0;

const parallel = (s: Segment, t: Segment): boolean => {
  const cross = (s.b.x - s.a.x) * (t.b.y - t.a.y) - (s.b.y - s.a.y) * (t.b.x - t.a.x);
  const scale = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
  return Math.abs(cross) <= 1e-12 * scale;
};

/** The single point where two non-parallel segments meet, if any. */
export function intersection(s: Segment, t: Segment): Point | undefined {
  if (parallel(s, t)) return undefined;
  const rx = s.b.x - s.a.x;
  const ry = s.b.y - s.a.y;
  const qx = t.b.x - t.a.x;
  const qy = t.b.y - t.a.y;
  const denominator = rx * qy - ry * qx;
  const u = ((t.a.x - s.a.x) * qy - (t.a.y - s.a.y) * qx) / denominator;
  const v = ((t.a.x - s.a.x) * ry - (t.a.y - s.a.y) * rx) / denominator;
  const p = { x: s.a.x + u * rx, y: s.a.y + u * ry };
  // Inside both, allowing the tolerance at the ends.
  const slackS = EPS / Math.hypot(rx, ry);
  const slackT = EPS / Math.hypot(qx, qy);
  if (u < -slackS || u > 1 + slackS || v < -slackT || v > 1 + slackT) return undefined;
  return p;
}

/** Every intersecting pair by testing all n(n-1)/2 pairs. */
export function bruteForcePairs(segments: readonly Segment[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (intersection(segments[i], segments[j])) out.push([i, j]);
    }
  }
  return out;
}

export function sweepIntersections(input: readonly Segment[]): SweepResult {
  // Orient every segment so that `a` is its first endpoint in sweep order.
  const segments = input.map((s) => (compare(s.a, s.b) <= 0 ? s : { a: s.b, b: s.a }));
  const label = (i: number) => `s${i + 1}`;

  interface Event {
    p: Point;
    starts: number[];
  }
  const queue: Event[] = [];
  const schedule = (p: Point): Event => {
    let at = 0;
    while (at < queue.length && compare(queue[at].p, p) < 0) at++;
    if (at < queue.length && compare(queue[at].p, p) === 0) return queue[at];
    const event = { p, starts: [] };
    queue.splice(at, 0, event);
    return event;
  };
  segments.forEach((s, i) => {
    schedule(s.a).starts.push(i);
    schedule(s.b);
  });

  const contains = (i: number, p: Point): boolean => {
    const s = segments[i];
    if (compare(p, s.a) < 0 || compare(p, s.b) > 0) return false;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    return Math.abs(dx * (p.y - s.a.y) - dy * (p.x - s.a.x)) <= EPS * Math.hypot(dx, dy);
  };
  const yAt = (i: number, x: number): number => {
    const s = segments[i];
    const dx = s.b.x - s.a.x;
    return Math.abs(dx) <= EPS ? s.a.y : s.a.y + ((x - s.a.x) / dx) * (s.b.y - s.a.y);
  };
  /** Order just to the right of a shared point: by slope, vertical last. */
  const bySlope = (i: number, j: number): number => {
    const s = segments[i];
    const t = segments[j];
    const d = (s.b.y - s.a.y) * (t.b.x - t.a.x) - (t.b.y - t.a.y) * (s.b.x - s.a.x);
    return Math.abs(d) > 1e-9 ? d : i - j;
  };

  const status: number[] = [];
  const crossings: Crossing[] = [];
  const pairKeys = new Set<number>();
  const pairs: [number, number][] = [];
  const steps: SweepStep[] = [];
  let tests = 0;
  let snapshot: Point[] = [];

  const record = (step: Pick<SweepStep, 'kind' | 'p' | 'note' | 'pair' | 'hit'>) => {
    steps.push({
      ...step,
      status: [...status],
      queue: snapshot,
      found: crossings.length,
      pairs: pairs.length,
      tests,
    });
  };

  const test = (i: number, j: number, p: Point) => {
    tests++;
    const hit = intersection(segments[i], segments[j]);
    const ahead = hit !== undefined && compare(hit, p) > 0;
    if (hit && ahead) {
      schedule(hit);
      snapshot = queue.map((e) => e.p);
    }
    record({
      kind: 'test',
      p,
      pair: [i, j],
      hit: ahead ? hit : undefined,
      note: ahead
        ? `${label(i)} and ${label(j)} are now neighbours and cross ahead of the line: add that point to the queue.`
        : `${label(i)} and ${label(j)} are now neighbours. They do not cross ahead of the line.`,
    });
  };

  while (queue.length > 0) {
    const event = queue.shift() as Event;
    const p = event.p;
    snapshot = queue.map((e) => e.p);
    const ending: number[] = [];
    const through: number[] = [];
    for (const i of status) {
      if (!contains(i, p)) continue;
      if (compare(segments[i].b, p) === 0) ending.push(i);
      else through.push(i);
    }
    const meeting = [...event.starts, ...ending, ...through];
    let reported = false;
    if (meeting.length > 1) {
      const here: number[] = [];
      for (let x = 0; x < meeting.length; x++) {
        for (let y = x + 1; y < meeting.length; y++) {
          const i = Math.min(meeting[x], meeting[y]);
          const j = Math.max(meeting[x], meeting[y]);
          if (parallel(segments[i], segments[j])) continue;
          here.push(i, j);
          const key = i * input.length + j;
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          pairs.push([i, j]);
        }
      }
      if (here.length > 0) {
        crossings.push({ p, segments: [...new Set(here)].sort((x, y) => x - y) });
        reported = true;
      }
    }
    // Take out everything through p, then put back what continues, in its new order.
    const gone = new Set([...ending, ...through]);
    for (let k = status.length - 1; k >= 0; k--) if (gone.has(status[k])) status.splice(k, 1);
    const entering = [...event.starts, ...through].sort(bySlope);
    let at = 0;
    while (at < status.length && yAt(status[at], p.x) < p.y) at++;
    status.splice(at, 0, ...entering);

    const parts: string[] = [];
    if (event.starts.length)
      parts.push(
        `${event.starts.map(label).join(', ')} start${event.starts.length === 1 ? 's' : ''}`,
      );
    if (ending.length)
      parts.push(`${ending.map(label).join(', ')} end${ending.length === 1 ? 's' : ''}`);
    if (through.length)
      parts.push(
        `${through.map(label).join(', ')} pass${through.length === 1 ? 'es' : ''} through and swap${through.length === 1 ? 's' : ''} order`,
      );
    record({
      kind: 'event',
      p,
      note: `${reported ? 'Intersection' : 'Event'}: ${parts.join('; ')}.`,
    });

    if (entering.length === 0) {
      if (at > 0 && at < status.length) test(status[at - 1], status[at], p);
    } else {
      if (at > 0) test(status[at - 1], status[at], p);
      const last = at + entering.length - 1;
      if (last + 1 < status.length) test(status[last], status[last + 1], p);
    }
  }
  const end = steps.length ? steps[steps.length - 1].p : { x: 0, y: 0 };
  snapshot = [];
  record({
    kind: 'done',
    p: end,
    note: `Done: ${crossings.length} intersection point${crossings.length === 1 ? '' : 's'} from ${tests} pair tests.`,
  });
  return { crossings, pairs, tests, steps };
}

/** Random segments on the lattice world (w x h), each a third of the height long or so. */
export function randomSegments(
  count: number,
  random: () => number,
  w: number,
  h: number,
  snap: (p: Point) => Point,
): Segment[] {
  const out: Segment[] = [];
  for (let guard = 0; out.length < count && guard < count * 20; guard++) {
    const cx = (0.1 + 0.8 * random()) * w;
    const cy = (0.1 + 0.8 * random()) * h;
    const angle = Math.PI * random();
    const half = (0.08 + 0.22 * random()) * h;
    const end = (sign: number) =>
      snap({
        x: Math.max(0.03 * w, Math.min(0.97 * w, cx + sign * half * Math.cos(angle))),
        y: Math.max(0.03 * h, Math.min(0.97 * h, cy + sign * half * Math.sin(angle))),
      });
    const s = { a: end(-1), b: end(1) };
    if (Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y) > 0.05 * h) out.push(s);
  }
  return out;
}
