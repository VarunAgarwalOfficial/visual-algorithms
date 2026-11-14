import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'metaballs',
    title: 'Metaballs',
    summary: 'Blobs that merge as they meet, outlined by marching squares on a coarse grid.',
    keywords: 'marching squares contour isoline adaptive quadtree',
    load: () => import('./metaballs'),
  },
];
