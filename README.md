# Visual algorithms

Forty-four interactive demos on one static site: sorting, graphs and
pathfinding, geometry, signals and maths, data structures, dynamic programming
and strings, and simulation. TypeScript, canvas, no runtime dependencies.

![The home page: demos grouped by section, each with a thumbnail](docs/home.png)

The idea is the one the first three demos had: do not show an algorithm's
answer, show it working. Every demo can be played, paused, stepped forwards and
backwards and slowed down, counts the work it does, and takes input you can
draw, drag, type or randomise.

## The demos

| Section                         | Demos                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sorting                         | Sorting (12 algorithms; bars, dots or colour wheel; optional sound), Sorting race                                                                                                                                                                                                    |
| Graphs and pathfinding          | Grid pathfinding (BFS, DFS, Dijkstra, A*, greedy, bidirectional, jump point search), Maze generation (backtracker, Prim, Kruskal, Wilson), Breadth-first and depth-first search, Topological sort, Strongly connected components, Minimum spanning tree, Maximum flow (Edmonds-Karp) |
| Geometry                        | Convex hull, Delaunay and Voronoi, Segment intersections (sweep line), Closest pair, Bezier and B-spline curves, Quadtree, Marching squares, Metaballs                                                                                                                               |
| Signals and maths               | Fourier epicycles, Fast Fourier transform, Convolution, L-systems, Perlin and simplex noise, Mandelbrot and Julia sets, Newton fractal, Reaction-diffusion, Game of Life, Elementary cellular automata                                                                               |
| Data structures                 | Binary heap, Binary search trees (plain, AVL, red-black), B-tree, Trie, Union-find, Hash table, Skip list                                                                                                                                                                            |
| Dynamic programming and strings | Edit distance, Longest common subsequence, Knapsack, String matching (KMP, Z), Huffman coding                                                                                                                                                                                        |
| Simulation                      | Boids, N-body gravity (Barnes-Hut), Elastic collisions (spatial hash), Cloth (Verlet), Stable fluids                                                                                                                                                                                 |

Each demo page carries its own short explanation and the formula that matters.
The three original ideas are described below.

## Using it

- The home page groups the demos by section; the search box filters them, and
  on a demo page it is a jump menu.
- A demo's settings and input are kept in the URL, so "Copy link" shares
  exactly what is on screen.
- Keys: `/` search, Space or `K` play/pause, arrows or `.` `,` step and back,
  `R` reset, `[` `]` slower and faster, `N` `P` next and previous demo, `T`
  theme, `H` home, `?` the list.
- The theme follows the system, or can be forced light or dark.
- A link reproduces a simulation on any screen: boids, collisions and cloth run
  in a fixed 800 × 600 world that is scaled to fit. Painted walls, drawn cells
  and cloth cuts are in the link. Things done by hand to a running simulation
  (dragging cloth, flinging a disc, stirring the fluid) are not, and each of
  those demos says so.
- An address that names no demo shows a not-found page with near matches;
  `404.html` does the same job for a static host.

## How it is built

Algorithms that proceed in steps run once and record a trace: a list of small
events (compare, swap, visit a cell, rotate at a node). Playback is a cursor
moving through that list, which is what makes pause, single-step, step back,
scrubbing and exact counters simple. Simulations advance in time instead and
keep a short history of snapshots for stepping back. `src/ui/player.ts` holds
both kinds of playback.

## The three original ideas

### Fourier epicycles

Sample a closed outline at N evenly spaced points and read each point as a
complex number `z_n = x_n + i·y_n`. The discrete Fourier transform gives one
coefficient per frequency:

```
c_k = (1/N) · Σ_n  z_n · e^(−2πi·k·n/N)
```

Each coefficient is a rotating vector: `|c_k|` is its radius, `arg(c_k)` its
starting angle, and `k` the number of turns it makes per lap. Adding them tip to
tail gives the pen position:

```
z(t) = Σ_k  c_k · e^(2πi·k·t),   0 ≤ t < 1
```

Two details matter. Bins above N/2 are treated as negative frequencies
(`k − N`); they agree at the sample points but only the slow rotation is smooth
in between. And the circles are sorted by radius, so the first m of them are the
best m-circle approximation in the least-squares sense. You can pick a preset,
load an SVG (all its shapes, with their transforms), or draw a shape, then change how many circles are used.

### Metaballs with marching squares

Each ball adds to a scalar field that falls off with distance:

```
f(x, y) = Σ_i  r_i² / ((x − x_i)² + (y − y_i)²)
```

The surface is the contour `f = 1`. One ball alone gives exactly its own circle;
nearby balls add up, so the contour bulges and merges.

Marching squares finds that contour by sampling `f` only at the corners of a
grid. Each cell's four corners are inside or outside, which makes a 4-bit case
index, and a 16-entry table says which cell edges the contour crosses. Two cases
are ambiguous (diagonal corners inside); the average of the four corners decides
whether they join. The crossing point on an edge between corner values `a` and
`b` is found by linear interpolation, `t = (1 − a) / (b − a)`. The demo lets you
turn that off to see the midpoint-only version, change the cell size, and show
the grid, the inside corners and the underlying field. An adaptive option
samples on a quadtree instead: a cell is split only where its corners or centre
disagree, and the outline is followed from cell to cell, so most of the empty
and full area is never sampled.

### Sorting

Each algorithm records `compare(i, j)`, `swap(i, j)`, `write(i, value)` or
`read(i)` steps. Comparisons, swaps and writes are counted separately: the O(n²)
sorts differ mostly in how many swaps they make, merge sort makes none because
it copies values back from a buffer, and counting and radix sort never compare
at all.

## The look

One stylesheet, `src/style.css`, holds the whole visual system as custom
properties: a five-step type scale (12, 14, 16, 20, 28 px), a seven-step spacing
scale (4 to 48 px), one control height (40 px, 44 px on a phone), and one palette
with light and dark values. Canvas colours come from the same file through
`src/ui/theme.ts`, and mean the same thing in every demo:

| Colour | Meaning                                |
| ------ | -------------------------------------- |
| amber  | being read or compared                 |
| red    | being written, moved or rejected       |
| green  | finished, found, or part of the answer |
| blue   | already explored                       |
| teal   | the current item, and the site accent  |

Text is set in IBM Plex Sans and IBM Plex Mono, bundled in `src/fonts` under the
SIL Open Font License (`src/fonts/OFL.txt`), so pages and canvas labels look the
same on every machine. Only the Latin subset is bundled; a few mathematical
symbols fall back to a system font.

Canvases are sized from the device-pixel box, so lines stay sharp on high-DPI
screens and when the browser zoom changes.

## Run

Needs Node 22.13 or newer (an even-numbered release; the workflow uses 22).

```
npm install
npm run dev        # development server
npm run build      # type-check and build to dist/
npm run preview    # serve the build
```

## Test and lint

```
npm test           # Vitest: a handful of tests per algorithm family
npm run lint       # ESLint, Prettier check and tsc
npm run format     # apply Prettier
npm run smoke      # loads every demo in a headless browser (needs agent-browser
                   # and `npm run preview` running); fails on any page error
```

The home page thumbnails in `public/thumbs` are screenshots of the demos
themselves. After changing how a demo looks, remake them with
`scripts/thumbnails.sh http://localhost:5173` while `npm run dev` is running
(needs agent-browser and ImageMagick).

## Layout

```
src/core/      pure algorithm code and its tests; no DOM
  sorting/ graphs/ geometry/ marching/ fourier/ signals/ fractals/
  automata/ structures/ strings/ sim/
  random.ts    seeded random numbers, so a seed in the URL reproduces an input
  encode.ts    compact encodings of points and cells for the URL
src/demos/     one folder per section, one module per demo, loaded on demand
  registry.ts  the sections; each folder's index.ts lists its demos
  layout.ts    the shared page skeleton
src/ui/        canvas sizing, playback, URL state, pointer input, controls, theme
src/main.ts    router, search, theme switch and keyboard shortcuts
src/home.ts    the index page and the not-found page
src/fonts/     IBM Plex Sans and Mono (woff2) and their licence
public/        favicon, 404.html, preview image, thumbnails
```

An ESLint rule keeps `src/core` from importing UI code or touching browser
globals.

## Accessibility

All controls are native form elements and work from the keyboard. Colours follow
the system light or dark scheme unless overridden. With
`prefers-reduced-motion`, the animated demos start paused on a complete frame
and can be advanced with Step or Play. Drawing and dragging on a canvas need a
pointer; presets, typed input and Randomise do not. The layout works down to
phone width, where controls are 44 px tall and the playback buttons sit directly
under the canvas. Text and control borders meet WCAG AA contrast in both themes,
and every focusable element shows a focus ring.

## Deploying

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages. It
does nothing until Pages is enabled for the repository with "GitHub Actions" as
the source. The social preview tag points at `og.png` with a relative address;
some sites want an absolute one, so put the site's full address in the
`og:image` tag in `index.html` once it is known.

## Credits

Grown from a rebuild of three hobby projects written between 2020 and 2022: a sorting
visualiser (2020), metaballs with marching squares and a Fourier transform
visualiser (both 2022, Python/Pygame and p5.js). The smiley preset is the test
drawing from the original Fourier project.

## Licence

MIT. See [LICENSE](LICENSE).
