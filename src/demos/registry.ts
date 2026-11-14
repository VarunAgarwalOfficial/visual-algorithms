import { demos as geometry } from './geometry';
import { demos as graphs } from './graphs';
import type { DemoEntry, Section } from './layout';
import { demos as signals } from './signals';
import { demos as simulation } from './simulation';
import { demos as sorting } from './sorting';
import { demos as strings } from './strings';
import { demos as structures } from './structures';

/** Every demo, grouped. Each section keeps its own list in its folder's index.ts. */
export const SECTIONS: readonly Section[] = [
  {
    id: 'sorting',
    title: 'Sorting',
    blurb: 'Putting an array in order, and what each method costs.',
    demos: sorting,
  },
  {
    id: 'graphs',
    title: 'Graphs and pathfinding',
    blurb: 'Searching grids and networks, building mazes, trees and flows.',
    demos: graphs,
  },
  {
    id: 'geometry',
    title: 'Geometry',
    blurb: 'Points, hulls, triangulations, curves and contours.',
    demos: geometry,
  },
  {
    id: 'signals',
    title: 'Signals and maths',
    blurb: 'Fourier analysis, fractals, noise and cellular automata.',
    demos: signals,
  },
  {
    id: 'structures',
    title: 'Data structures',
    blurb: 'Heaps, trees, tries and tables, one operation at a time.',
    demos: structures,
  },
  {
    id: 'strings',
    title: 'Dynamic programming and strings',
    blurb: 'Tables filled cell by cell, pattern matching and compression.',
    demos: strings,
  },
  {
    id: 'simulation',
    title: 'Simulation',
    blurb: 'Flocks, gravity, collisions, cloth and fluid.',
    demos: simulation,
  },
];

export const ALL_DEMOS: readonly DemoEntry[] = SECTIONS.flatMap((s) => s.demos);

export function sectionOf(id: string): Section | undefined {
  return SECTIONS.find((s) => s.demos.some((d) => d.id === id));
}

/** What the search reads for each demo, lower-cased once: the search runs on every keystroke. */
const HAYSTACK = new Map(
  SECTIONS.flatMap((section) =>
    section.demos.map(
      (demo) =>
        [
          demo,
          `${demo.title} ${demo.summary} ${demo.keywords ?? ''} ${section.title}`.toLowerCase(),
        ] as const,
    ),
  ),
);

/** Demos matching every word of the query, in index order. An empty query matches all. */
export function searchDemos(query: string): DemoEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ALL_DEMOS.filter((demo) => words.every((word) => HAYSTACK.get(demo)?.includes(word)));
}
