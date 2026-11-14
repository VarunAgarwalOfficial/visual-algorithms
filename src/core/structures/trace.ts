/** What a highlighted node, cell or slot is doing in a frame. The demos map these to palette colours. */
export type Role = 'compare' | 'change' | 'good' | 'visit';

/** Every structure records its work as frames: a full snapshot plus a plain sentence. */
export interface StepFrame {
  caption: string;
}

/** Highlights keyed by node id, array index or slot number. */
export type Marks<K = number> = Map<K, Role>;

export function marks<K = number>(...pairs: (readonly [K | null | undefined, Role])[]): Marks<K> {
  const out: Marks<K> = new Map();
  for (const [key, role] of pairs) if (key !== null && key !== undefined) out.set(key, role);
  return out;
}
