import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'convex-hull',
    title: 'Convex hull',
    summary: 'Four ways to wrap a set of points, all built on one left-or-right turn test.',
    lede: 'A set of points and the tightest boundary that wraps all of them, like a rubber band. Press Play to watch the boundary being found one point at a time.',
    keywords:
      'graham scan andrew monotone chain quickhull gift wrapping jarvis march cross product orientation',
    load: () => import('./convex-hull'),
  },
  {
    id: 'delaunay',
    title: 'Delaunay and Voronoi',
    summary:
      'Bowyer-Watson inserts points one at a time; the Voronoi diagram falls out as the dual.',
    lede: 'Points joined into triangles that are as wide as possible, and the regions of the plane nearest each point. Press Play to watch the points added one at a time.',
    keywords: 'delaunay triangulation bowyer watson voronoi diagram circumcircle dual mesh',
    load: () => import('./delaunay'),
  },
  {
    id: 'segment-intersection',
    title: 'Segment intersections',
    summary: 'A sweep line finds where segments cross by testing only neighbours.',
    lede: 'Line segments and the places where they cross, found by sweeping a line across the picture. Press Play to watch the sweep.',
    keywords: 'bentley ottmann sweep line segment intersection event queue status plane sweep',
    load: () => import('./segment-intersection'),
  },
  {
    id: 'closest-pair',
    title: 'Closest pair of points',
    summary: 'Divide and conquer finds the two nearest points without measuring every pair.',
    lede: 'A set of points and the two that are closest together, found without measuring every pair. Press Play to watch the search split the points in half again and again.',
    keywords: 'closest pair divide and conquer strip recursion nearest points',
    load: () => import('./closest-pair'),
  },
  {
    id: 'curves',
    title: 'Bézier and B-spline curves',
    summary: 'Curves built from nothing but repeated straight-line interpolation.',
    lede: 'A smooth curve built by repeatedly taking points part of the way along straight lines between control points. Press Play to watch it, or drag a control point.',
    keywords:
      'bezier de casteljau b-spline de boor knots control points bernstein spline interpolation',
    load: () => import('./curves'),
  },
  {
    id: 'quadtree',
    title: 'Quadtree',
    summary: 'Cells split where points are dense, so queries can skip most of the plane.',
    lede: 'Points filed into squares that split into four whenever they hold too many, so a search can skip empty areas. Press Play to watch the points go in.',
    keywords: 'quadtree spatial index range query nearest neighbour pruning point region bucket',
    load: () => import('./quadtree'),
  },
  {
    id: 'marching-squares',
    title: 'Marching squares',
    summary:
      'Contour lines through a height field you paint, one cell and one table lookup at a time.',
    lede: 'A field of heights, shaded light to dark, and the contour lines through it, drawn one square at a time. Press Play to watch the lines being drawn.',
    keywords:
      'marching squares contour isoline isoband saddle interpolation lookup table height map',
    load: () => import('./marching-squares'),
  },
  {
    id: 'metaballs',
    title: 'Metaballs',
    summary: 'Blobs that merge as they meet, outlined by marching squares on a coarse grid.',
    lede: 'Soft blobs that merge when they come close, outlined by the same square-by-square method as contour lines. Press Play to set them moving.',
    keywords: 'marching squares contour isoline adaptive quadtree',
    load: () => import('./metaballs'),
  },
];
