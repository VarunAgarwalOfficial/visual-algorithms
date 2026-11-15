import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'boids',
    title: 'Boids flocking',
    summary:
      'Three local rules make a flock; a uniform grid finds each boid its neighbours without asking everyone.',
    lede: 'A flock of simulated birds, each steering only by its nearest neighbours. Press Play to set the flock moving.',
    keywords:
      'boids flocking swarm reynolds separation alignment cohesion spatial grid neighbour search',
    load: () => import('./boids'),
  },
  {
    id: 'n-body',
    title: 'N-body gravity (Barnes-Hut)',
    summary:
      'Stars pull on each other; a quadtree lets far-away groups count as one mass, turning n² work into n log n.',
    lede: 'Stars pulling on each other by gravity, with far-away groups treated as one mass to save work. Press Play to set them moving.',
    keywords:
      'barnes-hut quadtree gravity n-body leapfrog velocity verlet symplectic orbit galaxy three-body figure-eight',
    load: () => import('./n-body'),
  },
  {
    id: 'collisions',
    title: 'Elastic collisions',
    summary:
      'Discs bounce in a box; a spatial hash finds the few pairs that can touch, and impulses resolve them.',
    lede: 'Discs bouncing around a box and off each other. Press Play to set them moving.',
    keywords:
      'spatial hash broad phase narrow phase impulse restitution elastic collision momentum maxwell boltzmann gas',
    load: () => import('./collisions'),
  },
  {
    id: 'cloth',
    title: 'Cloth (Verlet)',
    summary:
      'A sheet of particles held together by distance constraints, moved by Verlet integration and relaxed into shape.',
    lede: 'A sheet of cloth made of points joined by links of fixed length, hanging under gravity. Press Play to let it fall, then drag it.',
    keywords:
      'verlet integration cloth rope soft body constraints relaxation position based dynamics tearing',
    load: () => import('./cloth'),
  },
  {
    id: 'fluid',
    title: 'Stable fluids',
    summary:
      'Jos Stam’s grid fluid: advect backwards along the flow, diffuse, then project out the divergence.',
    lede: 'A simulated fluid on a grid, with dye that shows where it flows. Press Play, then drag across the picture to stir it.',
    keywords:
      'stable fluids stam navier-stokes semi-lagrangian advection pressure projection gauss-seidel smoke divergence',
    load: () => import('./fluid'),
  },
];
