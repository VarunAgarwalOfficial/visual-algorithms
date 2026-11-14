type Value = string | number | boolean;

/** Widens literal types, so a default of `false` gives a boolean field. */
type Widen<T> = {
  -readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends number
      ? number
      : T[K] extends boolean
        ? boolean
        : T[K];
};

export interface UrlState<T> {
  /** The current values: the defaults overridden by whatever the URL carried. Mutate, then call save(). */
  state: T;
  /** Writes the state into the address bar (values equal to their default are left out). */
  save(): void;
}

/** The part of the hash after "?", as search parameters. The route is "#/demo-id?key=value". */
export function hashParams(): URLSearchParams {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1));
}

/**
 * True when the link did not set `key` and the screen is phone-sized: the demo
 * may then start from a smaller default. The value differs from the usual
 * default, so it is written into the link and other screens show the same.
 */
export function phoneDefault(key: string): boolean {
  return !hashParams().has(key) && window.matchMedia('(max-width: 40rem)').matches;
}

/** The demo id in the hash, without the parameters. */
export function hashRoute(): string {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0];
}

/**
 * Keeps a demo's settings in the URL so a link reproduces what is on screen.
 * Each key's type is taken from its default: numbers and booleans are parsed,
 * anything unparseable falls back to the default. Demos should clamp numbers
 * themselves, as a hand-edited URL can hold any value.
 */
export function urlState<T extends Record<string, Value>>(defaults: T): UrlState<Widen<T>> {
  const params = hashParams();
  const state: Record<string, Value> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const initial = defaults[key];
    if (typeof initial === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n) && raw !== '') state[key] = n;
    } else if (typeof initial === 'boolean') {
      state[key] = raw === '1' || raw === 'true';
    } else {
      state[key] = raw;
    }
  }

  let timer = 0;
  const route = hashRoute();
  const write = () => {
    timer = 0;
    // A late write must not put this demo's state on the page the user has moved to.
    if (hashRoute() !== route) return;
    const out = new URLSearchParams();
    for (const key of Object.keys(defaults)) {
      const value = state[key];
      if (value === defaults[key]) continue;
      out.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    // Commas and tildes are safe in a hash and common in packed input; leaving them bare keeps links short.
    const query = out.toString().replace(/%2C/g, ',').replace(/%7E/g, '~');
    const url = `${window.location.pathname}${window.location.search}#/${route}${query ? `?${query}` : ''}`;
    window.history.replaceState(null, '', url);
  };

  return {
    state: state as Widen<T>,
    save() {
      // Sliders fire many events a second; browsers throttle replaceState.
      if (!timer) timer = window.setTimeout(write, 200);
    },
  };
}
