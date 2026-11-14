import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'pathfinding',
    title: 'Grid pathfinding',
    summary:
      'Seven ways to find a route across a grid you draw, with the work each one does counted.',
    keywords:
      'A* astar Dijkstra BFS DFS breadth-first depth-first greedy best-first bidirectional jump point search JPS heuristic Manhattan octile shortest path',
    load: () => import('./pathfinding'),
  },
  {
    id: 'maze',
    title: 'Maze generation',
    summary: 'Four ways to carve a maze, each a random spanning tree with its own texture.',
    keywords:
      'recursive backtracker DFS randomised Prim Kruskal Wilson loop-erased random walk uniform spanning tree union-find perfect maze',
    load: () => import('./maze'),
  },
  {
    id: 'graph-search',
    title: 'Breadth-first and depth-first search',
    summary: 'The two basic graph searches side by side: a queue against a stack.',
    keywords: 'BFS DFS breadth-first depth-first queue stack traversal spanning tree graph',
    load: () => import('./search'),
  },
  {
    id: 'topological-sort',
    title: 'Topological sort',
    summary:
      'Ordering a directed graph so every edge points forwards, and spotting when a cycle makes that impossible.',
    keywords:
      'Kahn DFS DAG directed acyclic graph in-degree dependency order scheduling cycle detection',
    load: () => import('./topo'),
  },
  {
    id: 'scc',
    title: 'Strongly connected components',
    summary: 'Finding the groups of nodes in a directed graph that can all reach each other.',
    keywords: 'Tarjan Kosaraju SCC lowlink index stack condensation DAG directed graph',
    load: () => import('./scc'),
  },
  {
    id: 'mst',
    title: 'Minimum spanning tree',
    summary: 'Joining every point with the least total edge weight, by Kruskal and by Prim.',
    keywords: 'Kruskal Prim MST union-find disjoint set cut property greedy Gabriel graph',
    load: () => import('./mst'),
  },
  {
    id: 'max-flow',
    title: 'Maximum flow',
    summary:
      'Pushing as much as possible from source to sink, one shortest augmenting path at a time.',
    keywords:
      'Edmonds-Karp Ford-Fulkerson augmenting path residual graph bottleneck min cut max-flow min-cut theorem bipartite matching capacity',
    load: () => import('./flow'),
  },
];
