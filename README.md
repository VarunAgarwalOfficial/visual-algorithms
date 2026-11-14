# Visual algorithms

Three small interactive demos on one static page: Fourier epicycles, metaballs
drawn with marching squares, and a sorting visualiser. TypeScript, canvas, no
runtime dependencies.

## The three ideas

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
load an SVG, or draw a shape, then change how many circles are used.

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
the grid, the inside corners and the underlying field.

### Sorting

Bubble, insertion, selection, merge, quick and heap sort. Each algorithm runs
once and records a trace of steps: `compare(i, j)`, `swap(i, j)` or
`write(i, value)`. Playback is a cursor moving through that list, which is what
makes pause, single-step, step back, scrubbing and exact counts simple.
Comparisons, swaps and writes are counted separately: the O(n²) sorts differ
mostly in how many swaps they make, and merge sort makes none because it copies
values back from a buffer.

## Run

Needs Node 20 or newer.

```
npm install
npm run dev        # development server
npm run build      # type-check and build to dist/
npm run preview    # serve the build
```

## Test and lint

```
npm test           # Vitest: unit tests for the algorithm code
npm run lint       # ESLint, Prettier check and tsc
npm run format     # apply Prettier
```

## Layout

```
src/core/      pure algorithm code and its tests; no DOM
  fourier/     DFT, epicycles, path resampling, preset shapes
  marching/    metaball field, marching-squares case table and contouring
  sorting/     step trace, the six algorithms, input generators
src/demos/     one module per demo: state, canvas drawing, controls
src/ui/        canvas sizing, animation loop, form controls, theme
```

An ESLint rule keeps `src/core` from importing UI code or touching browser
globals.

## Accessibility

All controls are native form elements and work from the keyboard. Colours follow
the system light or dark scheme. With `prefers-reduced-motion`, the animated
demos start paused on a complete frame and can be advanced with Step or Play.
Drawing your own shape needs a pointer; presets and SVG upload do not.

## Deploying

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages. It
does nothing until Pages is enabled for the repository with "GitHub Actions" as
the source.

## Credits

A rebuild of three hobby projects written between 2020 and 2022: a sorting
visualiser (2020), metaballs with marching squares and a Fourier transform
visualiser (both 2022, Python/Pygame and p5.js). The smiley preset is the test
drawing from the original Fourier project.

## Licence

MIT. See [LICENSE](LICENSE).
