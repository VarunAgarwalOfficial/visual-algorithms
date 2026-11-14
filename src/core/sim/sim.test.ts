import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { createFlock, stepFlock, visibleNeighbours, type BoidParams } from './boids';
import { createCloth, relax, stepCloth } from './cloth';
import {
  collide,
  createDiscs,
  discKinetic,
  discMomentum,
  gridFor,
  stepDiscs,
  type Discs,
} from './collisions';
import { createFluid, divergence, project } from './fluid';
import { buildGrid, createGrid, queryRadius, wrapDelta } from './grid';
import {
  addBody,
  buildQuadtree,
  createBodies,
  createQuadtree,
  directAccelerations,
  kineticEnergy,
  loadPreset,
  momentum,
  potentialEnergy,
  stepEuler,
  stepLeapfrog,
  treeForce,
} from './nbody';

describe('spatial grid', () => {
  it('finds the same neighbours as brute force, with and without wrap-around', () => {
    const random = seeded(11);
    const n = 400;
    const x = Float64Array.from({ length: n }, () => random() * 300);
    const y = Float64Array.from({ length: n }, () => random() * 200);
    const grid = createGrid(300, 200, 25);
    buildGrid(grid, x, y, n);
    for (const wrap of [false, true]) {
      for (const radius of [10, 25, 60]) {
        let gridTests = 0;
        for (let i = 0; i < n; i += 7) {
          const found: number[] = [];
          gridTests += queryRadius(grid, x, y, x[i], y[i], radius, wrap, found);
          const brute: number[] = [];
          for (let j = 0; j < n; j++) {
            const dx = wrap ? wrapDelta(x[j] - x[i], 300) : x[j] - x[i];
            const dy = wrap ? wrapDelta(y[j] - y[i], 200) : y[j] - y[i];
            if (dx * dx + dy * dy <= radius * radius) brute.push(j);
          }
          expect(found.sort((a, b) => a - b)).toEqual(brute);
        }
        expect(gridTests).toBeLessThan(Math.ceil(n / 7) * n);
      }
    }
  });

  it('gives boids the same motion as the brute-force lookup', () => {
    const params: BoidParams = {
      separation: 1.5,
      alignment: 1,
      cohesion: 1,
      radius: 50,
      fov: (270 * Math.PI) / 180,
      maxSpeed: 120,
      maxForce: 200,
      brute: false,
      pointerMode: 0,
      pointerX: 0,
      pointerY: 0,
      obstacles: [400, 300, 40],
    };
    const fast = createFlock(200, 800, 600, seeded(5));
    const slow = createFlock(200, 800, 600, seeded(5));
    const grid = createGrid(800, 600, params.radius);
    let fastTests = 0;
    let slowTests = 0;
    for (let step = 0; step < 30; step++) {
      fastTests += stepFlock(fast, params, grid, 1 / 60);
      slowTests += stepFlock(slow, { ...params, brute: true }, grid, 1 / 60);
    }
    expect(slowTests).toBe(30 * 200 * 199);
    expect(fastTests).toBeLessThan(slowTests / 4);
    for (let i = 0; i < 200; i++) {
      expect(fast.x[i]).toBeCloseTo(slow.x[i], 6);
      expect(fast.y[i]).toBeCloseTo(slow.y[i], 6);
    }
    expect(visibleNeighbours(fast, params, grid, 0).sort()).toEqual(
      visibleNeighbours(fast, { ...params, brute: true }, grid, 0).sort(),
    );
  });
});

describe('n-body', () => {
  function cloud(n: number) {
    const b = createBodies(n);
    const random = seeded(3);
    for (let i = 0; i < n; i++) {
      addBody(b, random() * 2 - 1, random() * 2 - 1, 0, 0, 0.5 + random());
    }
    // Two bodies on the same spot must not break the tree.
    b.x[1] = b.x[0];
    b.y[1] = b.y[0];
    return b;
  }

  it('Barnes-Hut with theta = 0 equals direct summation', () => {
    const b = cloud(300);
    const tree = createQuadtree();
    buildQuadtree(tree, b);
    let terms = 0;
    for (let i = 0; i < b.n; i++) terms += treeForce(tree, b, i, 0, 0.01);
    const ax = b.ax.slice();
    const ay = b.ay.slice();
    expect(terms).toBe(300 * 299);
    directAccelerations(b, 0.01);
    for (let i = 0; i < b.n; i++) {
      expect(ax[i]).toBeCloseTo(b.ax[i], 8);
      expect(ay[i]).toBeCloseTo(b.ay[i], 8);
    }
    // The root holds everything.
    expect(tree.mass[0]).toBeCloseTo(
      b.m.reduce((s, m) => s + m, 0),
      9,
    );
  });

  it('Barnes-Hut with theta = 0.5 is within a few percent, for far fewer terms', () => {
    const b = cloud(600);
    const tree = createQuadtree();
    buildQuadtree(tree, b);
    let terms = 0;
    for (let i = 0; i < b.n; i++) terms += treeForce(tree, b, i, 0.5, 0.01);
    const ax = b.ax.slice();
    const ay = b.ay.slice();
    directAccelerations(b, 0.01);
    let error = 0;
    let size = 0;
    for (let i = 0; i < b.n; i++) {
      error += Math.hypot(ax[i] - b.ax[i], ay[i] - b.ay[i]);
      size += Math.hypot(b.ax[i], b.ay[i]);
    }
    expect(error / size).toBeLessThan(0.02);
    expect(terms).toBeLessThan((600 * 599) / 3);
  });

  it('leapfrog keeps the energy of a two-body orbit where Euler drifts', () => {
    const run = (step: typeof stepLeapfrog) => {
      const b = createBodies(2);
      loadPreset(b, 'two-body', 2, seeded(1));
      const accelerate = () => directAccelerations(b, 0);
      accelerate();
      const energy = () => kineticEnergy(b) + potentialEnergy(b, 0);
      const start = energy();
      let worst = 0;
      for (let k = 0; k < 20000; k++) {
        step(b, 0.005, accelerate);
        worst = Math.max(worst, Math.abs((energy() - start) / start));
      }
      const p = momentum(b);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-12);
      return worst;
    };
    expect(run(stepLeapfrog)).toBeLessThan(1e-3);
    expect(run(stepEuler)).toBeGreaterThan(0.05);
  });

  it('the figure-eight returns to its start after one period', () => {
    const b = createBodies(3);
    loadPreset(b, 'figure-eight', 3, seeded(1));
    const start = b.x.slice(0, 3);
    const accelerate = () => directAccelerations(b, 0);
    accelerate();
    const steps = 20000;
    for (let k = 0; k < steps; k++) stepLeapfrog(b, 6.32591398 / steps, accelerate);
    for (let i = 0; i < 3; i++) expect(b.x[i]).toBeCloseTo(start[i], 3);
  });
});

describe('collisions', () => {
  function pair(): Discs {
    const d = createDiscs(2, 100, 100, 5, 0, 0, seeded(1));
    d.x.set([40, 51]);
    d.y.set([50, 53]);
    d.r.set([5, 8]);
    d.m.set([25, 64]);
    d.vx.set([30, -12]);
    d.vy.set([4, -3]);
    return d;
  }

  it('an elastic collision keeps momentum and kinetic energy', () => {
    const d = pair();
    const energy = discKinetic(d);
    const p = discMomentum(d);
    expect(collide(d, 0, 1, 1)).toBe(true);
    expect(discKinetic(d)).toBeCloseTo(energy, 8);
    expect(discMomentum(d).x).toBeCloseTo(p.x, 8);
    expect(discMomentum(d).y).toBeCloseTo(p.y, 8);
    // Pushed apart to exactly touching, and now separating: a second call changes nothing.
    expect(Math.hypot(d.x[1] - d.x[0], d.y[1] - d.y[0])).toBeCloseTo(13, 8);
    const vx = d.vx[0];
    collide(d, 0, 1, 1);
    expect(d.vx[0]).toBe(vx);
  });

  it('an inelastic collision keeps momentum and loses energy', () => {
    const d = pair();
    const energy = discKinetic(d);
    const p = discMomentum(d);
    collide(d, 0, 1, 0);
    expect(discMomentum(d).x).toBeCloseTo(p.x, 8);
    expect(discKinetic(d)).toBeLessThan(energy);
  });

  it('the grid finds every contact brute force finds, and energy holds in a full box', () => {
    const fast = createDiscs(300, 400, 300, 5, 1, 60, seeded(9));
    const slow = createDiscs(300, 400, 300, 5, 1, 60, seeded(9));
    const grid = gridFor(fast);
    const energy = discKinetic(fast);
    const a = { candidates: 0, contacts: 0 };
    const b = { candidates: 0, contacts: 0 };
    const params = { gravity: 0, restitution: 1, brute: false };
    for (let k = 0; k < 600; k++) stepDiscs(fast, params, grid, 1 / 120, a);
    expect(a.contacts).toBeGreaterThan(100);
    // From the same state, one step of each method must see the same contacts.
    for (const key of ['x', 'y', 'vx', 'vy'] as const) slow[key].set(fast[key]);
    a.candidates = a.contacts = 0;
    stepDiscs(slow, { ...params, brute: true }, grid, 1 / 60, b);
    stepDiscs(fast, params, grid, 1 / 60, a);
    expect(a.contacts).toBeGreaterThan(0);
    expect(a.contacts).toBe(b.contacts);
    expect(b.candidates).toBe((300 * 299) / 2);
    expect(a.candidates).toBeLessThan(b.candidates / 10);
    expect(discKinetic(fast)).toBeCloseTo(energy, 6);
    for (let i = 0; i < fast.n; i++) {
      for (let j = i + 1; j < fast.n; j++) {
        const gap =
          Math.hypot(fast.x[j] - fast.x[i], fast.y[j] - fast.y[i]) - fast.r[i] - fast.r[j];
        expect(gap).toBeGreaterThan(-0.5);
      }
    }
  });
});

describe('cloth', () => {
  it('relaxation brings a stretched pair back to its rest length', () => {
    const c = createCloth('rope', 2, 100, 100);
    const rest = c.rest[0];
    c.pinned[0] = 0;
    c.x[1] += rest * 0.8;
    c.y[1] += 7;
    expect(relax(c, false, 2)).toBeGreaterThan(1.5);
    expect(Math.hypot(c.x[1] - c.x[0], c.y[1] - c.y[0])).toBeCloseTo(rest, 9);
    // With one end pinned, only the free end moves.
    c.pinned[0] = 1;
    const x0 = c.x[0];
    c.x[1] += 5;
    relax(c, false, 2);
    expect(c.x[0]).toBe(x0);
    expect(Math.hypot(c.x[1] - c.x[0], c.y[1] - c.y[0])).toBeCloseTo(rest, 9);
  });

  it('more iterations leave a hanging cloth less stretched, and pins hold', () => {
    const hang = (iterations: number) => {
      const c = createCloth('cloth', 24, 800, 600);
      const params = { gravity: 900, wind: 0, iterations, damping: 0.01, tear: false, tearAt: 3 };
      let worst = 0;
      for (let k = 0; k < 400; k++) worst = stepCloth(c, params, 1 / 60);
      expect(c.y[0]).toBe(c.py[0]);
      expect(c.alive.every((a) => a === 1)).toBe(true);
      return worst;
    };
    const loose = hang(2);
    const stiff = hang(30);
    expect(stiff).toBeLessThan(loose);
    expect(stiff).toBeLessThan(1.1);
  });

  it('tearing removes over-stretched links', () => {
    const c = createCloth('cloth', 12, 800, 600);
    const params = { gravity: 900, wind: 0, iterations: 4, damping: 0.01, tear: true, tearAt: 1.5 };
    const grab = { index: c.n - 1, x: 790, y: 590 };
    for (let k = 0; k < 120; k++) stepCloth(c, params, 1 / 60, grab);
    expect(c.alive.some((a) => a === 0)).toBe(true);
  });
});

describe('fluid', () => {
  it('projection removes the divergence of a random velocity field', () => {
    const f = createFluid(32, 24);
    const random = seeded(4);
    for (let k = 0; k < f.u.length; k++) f.u[k] = random() * 2 - 1;
    for (let k = 0; k < f.v.length; k++) f.v[k] = random() * 2 - 1;
    const scratch = new Float32Array(32 * 24);
    const before = divergence(f, scratch);
    const few = project(f, 20, 1);
    const many = project(f, 600, 1.7);
    expect(before).toBeGreaterThan(0.5);
    expect(few).toBeLessThan(before / 4);
    expect(many).toBeLessThan(1e-4);
    // Walls stay closed.
    expect(f.u[0]).toBe(0);
    expect(f.v[5]).toBe(0);
  });
});
