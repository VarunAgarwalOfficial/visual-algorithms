import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'pathfinding',
    title: 'Grid pathfinding',
    summary:
      'Seven ways to find a route across a grid you draw, with the work each one does counted.',
    lede: 'A search for a route across a grid, from S (start) to G (goal), going around walls. Press Play to watch it reach out one cell at a time; drag on the grid to draw walls.',
    keywords:
      'A* astar Dijkstra BFS DFS breadth-first depth-first greedy best-first bidirectional jump point search JPS heuristic Manhattan octile shortest path',
    load: () => import('./pathfinding'),
  },
  {
    id: 'maze',
    title: 'Maze generation',
    summary: 'Four ways to carve a maze, each a random spanning tree with its own texture.',
    lede: 'A maze carved out of a grid of walled cells, removing one wall at a time. Press Play to watch it carved.',
    keywords:
      'recursive backtracker DFS randomised Prim Kruskal Wilson loop-erased random walk uniform spanning tree union-find perfect maze',
    load: () => import('./maze'),
  },
  {
    id: 'graph-search',
    title: 'Breadth-first and depth-first search',
    summary: 'The two basic graph searches side by side: a queue against a stack.',
    lede: 'Two ways of exploring a network of lettered nodes from A: nearest first, or as deep as possible first. Press Play to watch both explore side by side.',
    keywords: 'BFS DFS breadth-first depth-first queue stack traversal spanning tree graph',
    load: () => import('./search'),
  },
  {
    id: 'topological-sort',
    title: 'Topological sort',
    summary:
      'Ordering a directed graph so every edge points forwards, and spotting when a cycle makes that impossible.',
    lede: 'Tasks drawn as nodes, with arrows from each task to the ones that must wait for it, put into an order that respects every arrow. Press Play to watch the order being built.',
    keywords:
      'Kahn DFS DAG directed acyclic graph in-degree dependency order scheduling cycle detection',
    load: () => import('./topo'),
  },
  {
    id: 'scc',
    title: 'Strongly connected components',
    summary: 'Finding the groups of nodes in a directed graph that can all reach each other.',
    lede: 'A network of one-way arrows and the groups of nodes that can all reach each other. Press Play to watch the groups found.',
    keywords: 'Tarjan Kosaraju SCC lowlink index stack condensation DAG directed graph',
    load: () => import('./scc'),
  },
  {
    id: 'mst',
    title: 'Minimum spanning tree',
    summary: 'Joining every point with the least total edge weight, by Kruskal and by Prim.',
    lede: 'Points to be joined so every point is connected, using the shortest total length of line. Press Play to watch the lines chosen one at a time.',
    keywords: 'Kruskal Prim MST union-find disjoint set cut property greedy Gabriel graph',
    load: () => import('./mst'),
  },
  {
    id: 'max-flow',
    title: 'Maximum flow',
    summary:
      'Pushing as much as possible from source to sink, one shortest augmenting path at a time.',
    lede: 'A network of pipes, each with a capacity, carrying as much as possible from s (the source) to t (the sink). Press Play to watch flow pushed along one path at a time.',
    keywords:
      'Edmonds-Karp Ford-Fulkerson augmenting path residual graph bottleneck min cut max-flow min-cut theorem bipartite matching capacity',
    load: () => import('./flow'),
  },
];
