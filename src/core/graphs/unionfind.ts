/** Disjoint sets with path halving and union by size. */
export class UnionFind {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;

  constructor(n: number) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
    this.size = new Int32Array(n).fill(1);
  }

  find(x: number): number {
    const parent = this.parent;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  /** Joins the sets of a and b. Returns the surviving root, or -1 if they were already joined. */
  union(a: number, b: number): number {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return -1;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
    return ra;
  }

  sizeOf(x: number): number {
    return this.size[this.find(x)];
  }
}
