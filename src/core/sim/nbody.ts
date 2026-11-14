/**
 * Gravitational N-body in the plane with G = 1. Forces are softened:
 *
 *   a_i = sum_j m_j (x_j - x_i) / (|x_j - x_i|² + eps²)^(3/2)
 *
 * so two bodies passing very close do not get an unbounded kick.
 */
export interface Bodies {
  n: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  m: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
}

export function createBodies(capacity: number): Bodies {
  return {
    n: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    vx: new Float64Array(capacity),
    vy: new Float64Array(capacity),
    m: new Float64Array(capacity),
    ax: new Float64Array(capacity),
    ay: new Float64Array(capacity),
  };
}

/** Appends a body if there is room. Returns its index, or -1. */
export function addBody(b: Bodies, x: number, y: number, vx: number, vy: number, m: number) {
  if (b.n >= b.x.length) return -1;
  const i = b.n++;
  b.x[i] = x;
  b.y[i] = y;
  b.vx[i] = vx;
  b.vy[i] = vy;
  b.m[i] = m;
  return i;
}

// --- Quadtree ---

/** Below this depth a leaf keeps a list of bodies instead of splitting again. */
const MAX_DEPTH = 24;

/**
 * A quadtree over the bodies, in flat arrays. Each node is a square; a node
 * knows the total mass and the centre of mass of the bodies inside it.
 */
export interface Quadtree {
  nodes: number;
  /** Centre and half-width of each node's square. */
  cx: Float64Array;
  cy: Float64Array;
  half: Float64Array;
  mass: Float64Array;
  comX: Float64Array;
  comY: Float64Array;
  /** Four child indices per node, -1 where there is none. */
  child: Int32Array;
  leaf: Uint8Array;
  /** First body of a leaf; `next` chains the rest (only at the depth limit). */
  head: Int32Array;
  next: Int32Array;
}

export function createQuadtree(): Quadtree {
  return allocate(256, 0);
}

function allocate(nodeCapacity: number, bodyCapacity: number): Quadtree {
  return {
    nodes: 0,
    cx: new Float64Array(nodeCapacity),
    cy: new Float64Array(nodeCapacity),
    half: new Float64Array(nodeCapacity),
    mass: new Float64Array(nodeCapacity),
    comX: new Float64Array(nodeCapacity),
    comY: new Float64Array(nodeCapacity),
    child: new Int32Array(nodeCapacity * 4),
    leaf: new Uint8Array(nodeCapacity),
    head: new Int32Array(nodeCapacity),
    next: new Int32Array(bodyCapacity),
  };
}

function grow(tree: Quadtree) {
  const bigger = allocate(tree.cx.length * 2, tree.next.length);
  bigger.cx.set(tree.cx);
  bigger.cy.set(tree.cy);
  bigger.half.set(tree.half);
  bigger.mass.set(tree.mass);
  bigger.comX.set(tree.comX);
  bigger.comY.set(tree.comY);
  bigger.child.set(tree.child);
  bigger.leaf.set(tree.leaf);
  bigger.head.set(tree.head);
  bigger.next = tree.next;
  bigger.nodes = tree.nodes;
  Object.assign(tree, bigger);
}

function newNode(tree: Quadtree, cx: number, cy: number, half: number): number {
  if (tree.nodes >= tree.cx.length) grow(tree);
  const node = tree.nodes++;
  tree.cx[node] = cx;
  tree.cy[node] = cy;
  tree.half[node] = half;
  tree.mass[node] = 0;
  tree.comX[node] = 0;
  tree.comY[node] = 0;
  tree.leaf[node] = 1;
  tree.head[node] = -1;
  tree.child.fill(-1, node * 4, node * 4 + 4);
  return node;
}

/** The child of `node` whose quadrant holds (x, y), made on demand. */
function childFor(tree: Quadtree, node: number, x: number, y: number): number {
  const right = x >= tree.cx[node] ? 1 : 0;
  const down = y >= tree.cy[node] ? 1 : 0;
  const slot = node * 4 + down * 2 + right;
  if (tree.child[slot] < 0) {
    const h = tree.half[node] / 2;
    const made = newNode(
      tree,
      tree.cx[node] + (right ? h : -h),
      tree.cy[node] + (down ? h : -h),
      h,
    );
    tree.child[slot] = made;
  }
  return tree.child[slot];
}

/** Rebuilds the tree from scratch: O(n log n) for bodies that are not piled on one spot. */
export function buildQuadtree(tree: Quadtree, b: Bodies): void {
  tree.nodes = 0;
  if (tree.next.length < b.n) tree.next = new Int32Array(b.x.length);
  if (b.n === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < b.n; i++) {
    if (b.x[i] < minX) minX = b.x[i];
    if (b.x[i] > maxX) maxX = b.x[i];
    if (b.y[i] < minY) minY = b.y[i];
    if (b.y[i] > maxY) maxY = b.y[i];
  }
  const half = Math.max(maxX - minX, maxY - minY, 1e-9) * 0.5 * 1.0001;
  newNode(tree, (minX + maxX) / 2, (minY + maxY) / 2, half);

  for (let i = 0; i < b.n; i++) {
    const x = b.x[i];
    const y = b.y[i];
    const m = b.m[i];
    let node = 0;
    for (let depth = 0; ; depth++) {
      const wasEmpty = tree.mass[node] === 0 && tree.head[node] < 0;
      tree.mass[node] += m;
      tree.comX[node] += m * x;
      tree.comY[node] += m * y;
      if (tree.leaf[node]) {
        if (wasEmpty) {
          tree.head[node] = i;
          tree.next[i] = -1;
          break;
        }
        if (depth >= MAX_DEPTH) {
          tree.next[i] = tree.head[node];
          tree.head[node] = i;
          break;
        }
        // Split: the body that lived here moves one level down.
        const old = tree.head[node];
        tree.head[node] = -1;
        tree.leaf[node] = 0;
        const below = childFor(tree, node, b.x[old], b.y[old]);
        tree.mass[below] = b.m[old];
        tree.comX[below] = b.m[old] * b.x[old];
        tree.comY[below] = b.m[old] * b.y[old];
        tree.head[below] = old;
        tree.next[old] = -1;
      }
      node = childFor(tree, node, x, y);
    }
  }
  for (let node = 0; node < tree.nodes; node++) {
    if (tree.mass[node] > 0) {
      tree.comX[node] /= tree.mass[node];
      tree.comY[node] /= tree.mass[node];
    } else {
      // Massless bodies only: fall back to the middle of the square.
      tree.comX[node] = tree.cx[node];
      tree.comY[node] = tree.cy[node];
    }
  }
}

const stack = new Int32Array(4 * (MAX_DEPTH + 2) + 8);

/**
 * Barnes-Hut force on body i. Walks down from the root; a node whose square
 * has width s and whose centre of mass is at distance d is used as one point
 * mass when s / d < theta, and opened otherwise. theta = 0 opens everything,
 * which is the exact sum. Writes the acceleration into b.ax[i], b.ay[i] and
 * returns the number of force terms evaluated.
 *
 * `used`, if given, receives what the sum was made of: a node index n as n,
 * a single body j as -(j + 1).
 */
export function treeForce(
  tree: Quadtree,
  b: Bodies,
  i: number,
  theta: number,
  softening: number,
  used?: number[],
): number {
  const px = b.x[i];
  const py = b.y[i];
  const eps2 = softening * softening;
  const theta2 = theta * theta;
  let ax = 0;
  let ay = 0;
  let terms = 0;
  let top = 0;
  if (tree.nodes > 0) stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    if (tree.leaf[node]) {
      for (let j = tree.head[node]; j >= 0; j = tree.next[j]) {
        if (j === i) continue;
        const dx = b.x[j] - px;
        const dy = b.y[j] - py;
        const r2 = dx * dx + dy * dy + eps2;
        if (r2 === 0) continue;
        const inv = b.m[j] / (r2 * Math.sqrt(r2));
        ax += dx * inv;
        ay += dy * inv;
        terms++;
        used?.push(-(j + 1));
      }
      continue;
    }
    const dx = tree.comX[node] - px;
    const dy = tree.comY[node] - py;
    const d2 = dx * dx + dy * dy;
    const size = tree.half[node] * 2;
    const h = tree.half[node];
    const inside = Math.abs(px - tree.cx[node]) <= h && Math.abs(py - tree.cy[node]) <= h;
    if (!inside && size * size < theta2 * d2) {
      const r2 = d2 + eps2;
      const inv = tree.mass[node] / (r2 * Math.sqrt(r2));
      ax += dx * inv;
      ay += dy * inv;
      terms++;
      used?.push(node);
      continue;
    }
    for (let q = 0; q < 4; q++) {
      const c = tree.child[node * 4 + q];
      if (c >= 0) stack[top++] = c;
    }
  }
  b.ax[i] = ax;
  b.ay[i] = ay;
  return terms;
}

/** Accelerations of all bodies through the tree. Returns the number of force terms. */
export function treeAccelerations(tree: Quadtree, b: Bodies, theta: number, softening: number) {
  buildQuadtree(tree, b);
  let terms = 0;
  for (let i = 0; i < b.n; i++) terms += treeForce(tree, b, i, theta, softening);
  return terms;
}

/** Accelerations by summing every pair: n(n-1) force terms. */
export function directAccelerations(b: Bodies, softening: number): number {
  const eps2 = softening * softening;
  b.ax.fill(0, 0, b.n);
  b.ay.fill(0, 0, b.n);
  for (let i = 0; i < b.n; i++) {
    for (let j = i + 1; j < b.n; j++) {
      const dx = b.x[j] - b.x[i];
      const dy = b.y[j] - b.y[i];
      const r2 = dx * dx + dy * dy + eps2;
      if (r2 === 0) continue;
      const inv = 1 / (r2 * Math.sqrt(r2));
      b.ax[i] += dx * inv * b.m[j];
      b.ay[i] += dy * inv * b.m[j];
      b.ax[j] -= dx * inv * b.m[i];
      b.ay[j] -= dy * inv * b.m[i];
    }
  }
  return b.n * (b.n - 1);
}

// --- Integrators ---

/**
 * Leapfrog in kick-drift-kick form (velocity Verlet). `accelerate` must fill
 * b.ax and b.ay for the current positions; they must already be valid on entry.
 */
export function stepLeapfrog(b: Bodies, dt: number, accelerate: () => number): number {
  const half = dt / 2;
  for (let i = 0; i < b.n; i++) {
    b.vx[i] += b.ax[i] * half;
    b.vy[i] += b.ay[i] * half;
    b.x[i] += b.vx[i] * dt;
    b.y[i] += b.vy[i] * dt;
  }
  const terms = accelerate();
  for (let i = 0; i < b.n; i++) {
    b.vx[i] += b.ax[i] * half;
    b.vy[i] += b.ay[i] * half;
  }
  return terms;
}

/** Explicit Euler, for comparison: position and velocity both use the old state. */
export function stepEuler(b: Bodies, dt: number, accelerate: () => number): number {
  for (let i = 0; i < b.n; i++) {
    b.x[i] += b.vx[i] * dt;
    b.y[i] += b.vy[i] * dt;
    b.vx[i] += b.ax[i] * dt;
    b.vy[i] += b.ay[i] * dt;
  }
  return accelerate();
}

// --- Conserved quantities ---

export function kineticEnergy(b: Bodies): number {
  let sum = 0;
  for (let i = 0; i < b.n; i++) sum += 0.5 * b.m[i] * (b.vx[i] * b.vx[i] + b.vy[i] * b.vy[i]);
  return sum;
}

/** Potential energy with the same softening as the force. O(n²). */
export function potentialEnergy(b: Bodies, softening: number): number {
  const eps2 = softening * softening;
  let sum = 0;
  for (let i = 0; i < b.n; i++) {
    for (let j = i + 1; j < b.n; j++) {
      const dx = b.x[j] - b.x[i];
      const dy = b.y[j] - b.y[i];
      const r2 = dx * dx + dy * dy + eps2;
      if (r2 > 0) sum -= (b.m[i] * b.m[j]) / Math.sqrt(r2);
    }
  }
  return sum;
}

export function momentum(b: Bodies): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < b.n; i++) {
    x += b.m[i] * b.vx[i];
    y += b.m[i] * b.vy[i];
  }
  return { x, y };
}

// --- Starting arrangements ---

export type NBodyPreset = 'two-body' | 'binary-planet' | 'figure-eight' | 'galaxy' | 'clusters';

/** Moves to the frame where the centre of mass is at rest at the origin. */
function centre(b: Bodies) {
  let m = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < b.n; i++) {
    m += b.m[i];
    x += b.m[i] * b.x[i];
    y += b.m[i] * b.y[i];
    vx += b.m[i] * b.vx[i];
    vy += b.m[i] * b.vy[i];
  }
  if (m === 0) return;
  for (let i = 0; i < b.n; i++) {
    b.x[i] -= x / m;
    b.y[i] -= y / m;
    b.vx[i] -= vx / m;
    b.vy[i] -= vy / m;
  }
}

/** A disc of light bodies on near-circular orbits round a heavy centre. */
function disc(
  b: Bodies,
  count: number,
  cx: number,
  cy: number,
  vx: number,
  vy: number,
  radius: number,
  centralMass: number,
  discMass: number,
  spin: number,
  random: () => number,
) {
  addBody(b, cx, cy, vx, vy, centralMass);
  const each = discMass / Math.max(1, count - 1);
  for (let k = 1; k < count; k++) {
    // Uniform over the area between an inner gap and the rim.
    const inner = radius * 0.12;
    const r = Math.sqrt(inner * inner + random() * (radius * radius - inner * inner));
    const angle = random() * Math.PI * 2;
    // Mass inside r: the centre plus the share of the disc within that radius.
    const within = centralMass + discMass * ((r * r - inner * inner) / (radius * radius));
    const speed = Math.sqrt(within / r) * (1 + (random() - 0.5) * 0.04);
    addBody(
      b,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
      vx - Math.sin(angle) * speed * spin,
      vy + Math.cos(angle) * speed * spin,
      each,
    );
  }
}

/**
 * Fills `b` with a named arrangement. `count` matters for the galaxy and the
 * clusters. Returns the softening length that suits the arrangement.
 */
export function loadPreset(
  b: Bodies,
  preset: NBodyPreset,
  count: number,
  random: () => number,
): number {
  b.n = 0;
  if (preset === 'two-body') {
    // An ellipse: a circular orbit would need speed sqrt(M / d) between the two.
    const d = 1.4;
    const v = Math.sqrt(1.3 / d) * 0.75;
    addBody(b, 0, 0, 0, 0, 1);
    addBody(b, d, 0, 0, v, 0.3);
    centre(b);
    return 0;
  }
  if (preset === 'binary-planet') {
    const d = 0.5;
    const v = Math.sqrt(2 / d) / 2;
    addBody(b, -d / 2, 0, 0, -v, 1);
    addBody(b, d / 2, 0, 0, v, 1);
    addBody(b, 1.25, 0, 0, Math.sqrt(2 / 1.25), 0.001);
    centre(b);
    return 0;
  }
  if (preset === 'figure-eight') {
    // Chenciner and Montgomery's choreography: three equal masses chase each other round one curve.
    const px = 0.97000436;
    const py = 0.24308753;
    const vx = 0.93240737;
    const vy = 0.86473146;
    addBody(b, -px, py, vx / 2, vy / 2, 1);
    addBody(b, px, -py, vx / 2, vy / 2, 1);
    addBody(b, 0, 0, -vx, -vy, 1);
    return 0;
  }
  if (preset === 'galaxy') {
    disc(b, count, 0, 0, 0, 0, 1.3, 1, 0.1, 1, random);
    centre(b);
    return 0.03;
  }
  const first = Math.ceil(count / 2);
  disc(b, first, -1.15, -0.3, 0.22, 0.05, 0.55, 0.6, 0.12, 1, random);
  disc(b, count - first, 1.15, 0.3, -0.22, -0.05, 0.55, 0.6, 0.12, -1, random);
  centre(b);
  return 0.03;
}
