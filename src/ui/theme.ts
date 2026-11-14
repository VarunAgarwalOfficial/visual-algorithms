export interface Palette {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  /** Being read or compared right now. */
  compare: string;
  /** Being written or moved right now. */
  change: string;
  /** Finished, or part of the answer. */
  good: string;
  /** Already explored. */
  visit: string;
  /** Six categorical colours for groups (components, clusters, runs). */
  series: readonly string[];
}

export type ThemeChoice = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const CHANGE_EVENT = 'themechange';
const SERIES = 6;

function read(): Palette {
  const style = getComputedStyle(document.documentElement);
  // light-dark() values are resolved through a probe element: custom properties keep the raw text.
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);
  const get = (name: string) => {
    probe.style.color = `var(--canvas-${name})`;
    return toHex(getComputedStyle(probe).color) ?? style.getPropertyValue(`--canvas-${name}`);
  };
  const palette: Palette = {
    bg: get('bg'),
    ink: get('ink'),
    muted: get('muted'),
    faint: get('faint'),
    accent: get('accent'),
    compare: get('compare'),
    change: get('change'),
    good: get('good'),
    visit: get('visit'),
    series: Array.from({ length: SERIES }, (_, i) => get(`series-${i + 1}`)),
  };
  probe.remove();
  return palette;
}

/** Converts a computed "rgb(r, g, b)" colour to #rrggbb. */
function toHex(colour: string): string | undefined {
  const parts = colour.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return undefined;
  return `#${parts
    .slice(0, 3)
    .map((p) => Math.round(Number(p)).toString(16).padStart(2, '0'))
    .join('')}`;
}

const scheme = window.matchMedia('(prefers-color-scheme: dark)');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function themeChoice(): ThemeChoice {
  const stored = safeStorage()?.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

/** Applies a theme choice to the page, remembers it, and tells the demos to repaint. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === 'auto') {
    delete document.documentElement.dataset.theme;
    safeStorage()?.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.dataset.theme = choice;
    safeStorage()?.setItem(STORAGE_KEY, choice);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // storage can be blocked; the choice then lasts for the page only
  }
}

/** True when the page is currently drawn dark, whichever way that was decided. */
export function isDark(): boolean {
  const choice = document.documentElement.dataset.theme;
  return choice ? choice === 'dark' : scheme.matches;
}

/**
 * The canvas colours from the stylesheet. `onChange` runs when the theme flips
 * so a paused demo can repaint. Returns the palette holder and a function that
 * removes the listeners.
 */
export function watchPalette(onChange: () => void): { palette: Palette; dispose(): void } {
  const listener = () => {
    holder.palette = read();
    onChange();
  };
  const holder = {
    palette: read(),
    dispose: () => {
      scheme.removeEventListener('change', listener);
      window.removeEventListener(CHANGE_EVENT, listener);
      document.fonts.removeEventListener('loadingdone', onChange);
    },
  };
  // A canvas keeps the fallback font it was drawn with; draw again when the bundled one arrives.
  document.fonts.addEventListener('loadingdone', onChange);
  scheme.addEventListener('change', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return holder;
}

export function prefersReducedMotion(): boolean {
  return motion.matches;
}

/** Parses #rgb or #rrggbb into [r, g, b]; falls back to mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return [128, 128, 128];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A colour between two hex colours; t = 0 gives `from`, t = 1 gives `to`. */
export function mix(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
