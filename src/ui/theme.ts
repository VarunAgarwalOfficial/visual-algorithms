export interface Palette {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  compare: string;
  change: string;
}

function read(): Palette {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(`--canvas-${name}`).trim();
  return {
    bg: get('bg'),
    ink: get('ink'),
    muted: get('muted'),
    faint: get('faint'),
    accent: get('accent'),
    compare: get('compare'),
    change: get('change'),
  };
}

const scheme = window.matchMedia('(prefers-color-scheme: dark)');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The canvas colours from the stylesheet. `onChange` runs when the colour
 * scheme flips so a paused demo can repaint. Returns the palette holder and a
 * function that removes the listener.
 */
export function watchPalette(onChange: () => void): { palette: Palette; dispose(): void } {
  const holder = { palette: read(), dispose: () => scheme.removeEventListener('change', listener) };
  const listener = () => {
    holder.palette = read();
    onChange();
  };
  scheme.addEventListener('change', listener);
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
