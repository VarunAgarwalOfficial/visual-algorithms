import { describe, expect, test } from 'vitest';
import { seeded } from '../random';
import { edmondsKarp } from './flow';
import {
  dagPreset,
  decodeGraph,
  encodeGraph,
  flowPreset,
  gabrielPairs,
  allPairs,
  lengthWeight,
  letter,
  scatter,
  sccPreset,
  searchPreset,
  type Graph,
} from './graph';
import { WALL, emptyGrid, isLegalPath, mazeGrid, pathCost, searchGrid } from './grid';
import { MAZE_ALGORITHMS, generateMaze, solveMaze } from './maze';
import { kruskal, prim } from './mst';
import { kosaraju, tarjan } from './scc';
import { breadthFirst, depthFirst, kahn, topologicalDfs } from './traverse';

describe('grid pathfinding', () => {
  test('optimal searches agree with Dijkstra on random grids, and every path is legal', () => {
    const random = seeded(7);
    let reachable = 0;
    for (let trial = 0; trial < 300; trial++) {
      const grid = emptyGrid(3 + Math.floor(random() * 18), 2 + Math.floor(random() * 14));
      const density = random() * 0.45;
      for (let i = 0; i < grid.cells.length; i++) if (random() < density) grid.cells[i] = WALL;
      const start = Math.floor(random() * grid.cells.length);
      const goal = Math.floor(random() * grid.cells.length);
      grid.cells[start] = grid.cells[goal] = 0;
      for (const diagonal of [false, true]) {
        const options = { diagonal, heuristic: diagonal ? 'octile' : 'manhattan' } as const;
        const best = searchGrid('dijkstra', grid, start, goal, options);
        const optimal = [
          'astar',
          'bfs',
          'bidirectional',
          ...(diagonal ? ['jps' as const] : []),
        ] as const;
        for (const id of optimal) {
          const run = searchGrid(id, grid, start, goal, options);
          expect(run.path.length > 0).toBe(best.path.length > 0);
          if (run.path.length === 0) continue;
          expect(isLegalPath(grid, run.path, diagonal)).toBe(true);
          expect([run.path[0], run.path[run.path.length - 1]]).toEqual([start, goal]);
          // Breadth-first searches minimise steps; the others minimise cost.
          if (id === 'bfs' || id === 'bidirectional') {
            const steps = searchGrid('bfs', grid, start, goal, options).path.length;
            expect(run.path.length).toBe(steps);
          } else {
            expect(pathCost(grid, run.path)).toBeCloseTo(best.cost, 9);
          }
        }
        for (const id of ['dfs', 'greedy'] as const) {
          const run = searchGrid(id, grid, start, goal, options);
          expect(run.path.length > 0).toBe(best.path.length > 0);
          if (run.path.length > 0) expect(isLegalPath(grid, run.path, diagonal)).toBe(true);
        }
        if (best.path.length > 0) reachable++;
      }
    }
    expect(reachable).toBeGreaterThan(200);
  });

  test('Dijkstra goes round mud when that is cheaper, breadth-first search does not', () => {
    const grid = emptyGrid(5, 3);
    grid.cells.set([2, 2, 2], 6); // the middle row between start and goal is mud
    const options = { diagonal: false, heuristic: 'manhattan' } as const;
    expect(searchGrid('bfs', grid, 5, 9, options).cost).toBe(16);
    expect(searchGrid('dijkstra', grid, 5, 9, options).cost).toBe(6);
    expect(searchGrid('astar', grid, 5, 9, options).cost).toBe(6);
  });

  test('jump point search expands far fewer cells than A* on open ground', () => {
    const grid = emptyGrid(30, 20);
    const options = { diagonal: true, heuristic: 'octile' } as const;
    const jps = searchGrid('jps', grid, 0, 599, options);
    const dijkstra = searchGrid('dijkstra', grid, 0, 599, options);
    expect(jps.cost).toBeCloseTo(dijkstra.cost, 9);
    expect(jps.steps.length).toBeLessThan(dijkstra.steps.length / 20);
  });

  test('the maze preset connects its two corners', () => {
    const grid = mazeGrid(31, 23, seeded(3));
    const run = searchGrid('bfs', grid, 32, 21 * 31 + 29, {
      diagonal: false,
      heuristic: 'manhattan',
    });
    expect(run.path.length).toBeGreaterThan(40);
  });
});

describe('maze generation', () => {
  test('every generator produces a spanning tree and its trace replays to it', () => {
    for (const { id } of MAZE_ALGORITHMS) {
      const cols = 13;
      const rows = 9;
      const maze = generateMaze(id, cols, rows, seeded(11));
      let passages = 0;
      for (const bits of maze.open) for (let b = bits; b > 0; b >>= 1) passages += b & 1;
      // A tree on n cells has n - 1 edges; each is counted from both sides.
      expect(passages / 2).toBe(cols * rows - 1);
      for (let cell = 1; cell < cols * rows; cell++) {
        expect(solveMaze(maze.open, cols, 0, cell).length).toBeGreaterThan(1);
      }
    }
  });

  test('the same seed gives the same maze', () => {
    const a = generateMaze('wilson', 8, 6, seeded(5));
    const b = generateMaze('wilson', 8, 6, seeded(5));
    expect([...a.open]).toEqual([...b.open]);
  });
});

describe('minimum spanning tree', () => {
  const build = (seed: number, pairs: (n: number) => [number, number][]): Graph => {
    const nodes = scatter(14, seeded(seed));
    return {
      nodes,
      edges: pairs(14).map(([a, b]) => ({ a, b, w: lengthWeight(nodes[a], nodes[b]) })),
    };
  };

  test('Prim and Kruskal agree and build a tree', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const graph = build(seed, allPairs);
      const p = prim(graph);
      const k = kruskal(graph);
      expect(p.weight).toBe(k.weight);
      expect(p.tree.length).toBe(13);
      expect(k.tree.length).toBe(13);
    }
  });

  test('the Gabriel graph keeps the minimum spanning tree', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const nodes = build(seed, allPairs).nodes;
      const gabriel = build(seed, () => gabrielPairs(nodes));
      expect(kruskal(gabriel).weight).toBe(kruskal(build(seed, allPairs)).weight);
    }
  });

  test('a disconnected graph gives a forest', () => {
    const graph: Graph = {
      nodes: scatter(4, seeded(1)),
      edges: [
        { a: 0, b: 1, w: 3 },
        { a: 2, b: 3, w: 4 },
      ],
    };
    expect(prim(graph).weight).toBe(7);
    expect(kruskal(graph).weight).toBe(7);
  });
});

describe('graph search and topological sort', () => {
  test('breadth-first search finds shortest distances; depth-first search visits the same nodes', () => {
    const graph = searchPreset('grid', seeded(1));
    const bfs = breadthFirst(graph, 0, letter);
    // In the grid preset node 11 is five edges from node 0.
    expect(bfs.frames[bfs.frames.length - 1].sub[11]).toBe(5);
    expect([...bfs.order].sort((a, b) => a - b)).toEqual([...graph.nodes.keys()]);
    expect([...depthFirst(graph, 0, letter).order].sort((a, b) => a - b)).toEqual([
      ...graph.nodes.keys(),
    ]);
  });

  test('both topological sorts respect every edge', () => {
    for (const graph of [dagPreset('layers', seeded(1)), dagPreset('random', seeded(2))]) {
      for (const run of [kahn(graph, letter), topologicalDfs(graph, letter)]) {
        expect(run.acyclic).toBe(true);
        expect(run.order.length).toBe(graph.nodes.length);
        for (const e of graph.edges) {
          expect(run.order.indexOf(e.a)).toBeLessThan(run.order.indexOf(e.b));
        }
      }
    }
  });

  test('both topological sorts report a cycle', () => {
    const graph = dagPreset('cycle', seeded(1));
    expect(kahn(graph, letter).acyclic).toBe(false);
    expect(topologicalDfs(graph, letter).acyclic).toBe(false);
  });
});

describe('strongly connected components', () => {
  const groups = (comp: number[]) => {
    const sets = new Map<number, string>();
    comp.forEach((c, i) => sets.set(c, (sets.get(c) ?? '') + letter(i)));
    return [...sets.values()].sort();
  };

  test('Tarjan and Kosaraju find the textbook components', () => {
    const graph = sccPreset('classic', seeded(1));
    expect(groups(tarjan(graph, letter).comp)).toEqual(['ABE', 'CD', 'FG', 'H']);
    expect(groups(kosaraju(graph, letter).comp)).toEqual(['ABE', 'CD', 'FG', 'H']);
    expect(tarjan(graph, letter).condensationEdges).toBe(5);
  });

  test('the two algorithms agree on random graphs', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const graph = sccPreset('random', seeded(seed));
      expect(groups(tarjan(graph, letter).comp)).toEqual(groups(kosaraju(graph, letter).comp));
    }
  });
});

describe('maximum flow', () => {
  test('the textbook network carries 23', () => {
    expect(edmondsKarp(flowPreset('classic', seeded(1)), 0, 1, letter).total).toBe(23);
    expect(edmondsKarp(flowPreset('matching', seeded(1)), 0, 1, letter).total).toBe(4);
  });

  test('flow equals cut capacity, respects capacities and is conserved', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const graph = flowPreset('random', seeded(seed));
      const run = edmondsKarp(graph, 0, 1, letter);
      expect(run.cut.reduce((sum, i) => sum + graph.edges[i].w, 0)).toBe(run.total);
      const net = graph.nodes.map(() => 0);
      graph.edges.forEach((e, i) => {
        expect(run.flow[i]).toBeGreaterThanOrEqual(0);
        expect(run.flow[i]).toBeLessThanOrEqual(e.w);
        net[e.a] -= run.flow[i];
        net[e.b] += run.flow[i];
      });
      expect(net.slice(2).every((v) => v === 0)).toBe(true);
      expect(net[1]).toBe(run.total);
    }
  });
});

test('a graph survives the URL, and bad input is dropped', () => {
  const graph = flowPreset('classic', seeded(1));
  const limits = { maxNodes: 20, maxWeight: 99, directed: true };
  const back = decodeGraph(encodeGraph(graph), limits);
  expect(back?.edges).toEqual(graph.edges);
  expect(back?.nodes.length).toBe(6);
  const odd = decodeGraph(`${encodeGraph(graph)}.00a.0z3.02g.!!!.23zzzz`, limits);
  expect(odd?.edges.length).toBe(graph.edges.length + 1);
  expect(odd?.edges[odd.edges.length - 1].w).toBe(99);
  expect(decodeGraph('', limits)).toBeUndefined();
});
