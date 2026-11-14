import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'convex-hull',
    title: 'Convex hull',
    summary: 'Four ways to wrap a set of points, all built on one left-or-right turn test.',
    keywords:
      'graham scan andrew monotone chain quickhull gift wrapping jarvis march cross product orientation',
    load: () => import('./convex-hull'),
  },
  {
    id: 'delaunay',
    title: 'Delaunay and Voronoi',
    summary:
      'Bowyer-Watson inserts points one at a time; the Voronoi diagram falls out as the dual.',
    keywords: 'delaunay triangulation bowyer watson voronoi diagram circumcircle dual mesh',
    load: () => import('./delaunay'),
  },
  {
    id: 'segment-intersection',
    title: 'Segment intersections',
    summary: 'A sweep line finds where segments cross by testing only neighbours.',
    keywords: 'bentley ottmann sweep line segment intersection event queue status plane sweep',
    load: () => import('./segment-intersection'),
  },
  {
    id: 'closest-pair',
    title: 'Closest pair of points',
    summary: 'Divide and conquer finds the two nearest points without measuring every pair.',
    keywords: 'closest pair divide and conquer strip recursion nearest points',
    load: () => import('./closest-pair'),
  },
  {
    id: 'curves',
    title: 'Bézier and B-spline curves',
    summary: 'Curves built from nothing but repeated straight-line interpolation.',
    keywords:
      'bezier de casteljau b-spline de boor knots control points bernstein spline interpolation',
    load: () => import('./curves'),
  },
  {
    id: 'quadtree',
    title: 'Quadtree',
    summary: 'Cells split where points are dense, so queries can skip most of the plane.',
    keywords: 'quadtree spatial index range query nearest neighbour pruning point region bucket',
    load: () => import('./quadtree'),
  },
  {
    id: 'marching-squares',
    title: 'Marching squares',
    summary:
      'Contour lines through a height field you paint, one cell and one table lookup at a time.',
    keywords:
      'marching squares contour isoline isoband saddle interpolation lookup table height map',
    load: () => import('./marching-squares'),
  },
  {
    id: 'metaballs',
    title: 'Metaballs',
    summary: 'Blobs that merge as they meet, outlined by marching squares on a coarse grid.',
    keywords: 'marching squares contour isoline adaptive quadtree',
    load: () => import('./metaballs'),
  },
];
