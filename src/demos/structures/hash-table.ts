import {
  HASH_SIZES,
  HashTable,
  type HashFrame,
  type HashScheme,
} from '../../core/structures/hashtable';
import { fieldset, select, slider } from '../../ui/dom';
import { urlState } from '../../ui/url';
import { formula, legend, prose, stats, type Mount } from '../layout';
import { cellGrid, drawCells, line, plate, roleColour, roleStyle, tint, type Gfx } from './draw';
import { keyOpCodec, keyOpsFieldset, opsDemo, presetSelect, record, refuse } from './shared';

const MAX_KEY = 999;
const MAX_KEYS = 30;
const SCHEMES: readonly { id: HashScheme; name: string }[] = [
  { id: 'linear', name: 'Linear probing' },
  { id: 'quadratic', name: 'Quadratic probing' },
  { id: 'double', name: 'Double hashing' },
  { id: 'chain', name: 'Separate chaining' },
];

export const mount: Mount = (root, entry) => {
  const url = urlState({
    scheme: 'linear',
    load: 0.7,
    ops: 'i25.i14.i36.i3.i47.i8.i19',
    seed: 1,
    speed: 3,
  });
  const settings = url.state;
  settings.load = Math.max(0.5, Math.min(0.9, Math.round(settings.load * 20) / 20));
  const scheme = (): HashScheme => SCHEMES.find((s) => s.id === settings.scheme)?.id ?? 'linear';
  const codec = keyOpCodec(MAX_KEY);
  let keys: number[] = [];

  const counters = stats({
    live: 'Keys',
    m: 'Slots',
    load: 'Load factor',
    tombs: 'Tombstones',
    probes: 'Probes, this operation',
    average: 'Average probes',
  });

  const demo = opsDemo<HashFrame>({
    root,
    entry,
    canvasLabel: 'The hash table as a row of numbered slots. Probed slots are highlighted.',
    settings,
    save: url.save,
    ...codec,
    run(ops) {
      const table = new HashTable(scheme(), settings.load);
      const recording = record(table.frames, ops, (op) => {
        const key = Number(op.slice(1));
        if (op[0] === 'd') table.delete(key);
        else if (op[0] === 'f') table.find(key);
        else if (table.size >= MAX_KEYS && !table.has(key)) {
          refuse(
            table.frames,
            `This demo stops at ${MAX_KEYS} keys (the largest table has ${HASH_SIZES[HASH_SIZES.length - 1]} slots). Delete one first.`,
          );
        } else table.insert(key);
      });
      keys = table.keys();
      return recording;
    },
    draw,
    show(frame) {
      const used = scheme() === 'chain' ? frame.live : frame.live + frame.tombs;
      counters.set({
        live: frame.live,
        m: frame.m,
        load: (used / frame.m).toFixed(2),
        tombs: frame.tombs,
        probes: frame.probes,
        average: frame.operations === 0 ? '0' : (frame.totalProbes / frame.operations).toFixed(2),
      });
    },
  });

  function draw(frame: HashFrame, g: Gfx) {
    const { ctx, palette, width, height } = g;
    const pad = Math.max(8, width * 0.025);
    const chained = scheme() === 'chain';
    const box = { x: pad, y: pad + 4, w: width - 2 * pad, h: height - 2 * pad - 4 };
    if (!chained) {
      const probe = cellGrid(frame.m, box, 26, 52);
      // Centre the block of rows vertically.
      const grid = cellGrid(
        frame.m,
        { ...box, y: box.y + Math.max(0, (box.h - probe.height) / 2) },
        26,
        52,
      );
      drawCells(
        g,
        frame.slots.map((slot, i) => ({
          id: slot && !slot.tomb ? slot.id : undefined,
          text: slot ? (slot.tomb ? '×' : String(slot.key)) : '',
          dim: slot?.tomb,
          role: frame.hi.get(i),
          sub: String(i),
        })),
        grid,
        'key',
      );
      return;
    }
    // Chaining: a row of bucket heads, each with its list hanging below.
    const longest = Math.max(1, ...frame.chains.map((chain) => chain.length));
    let rows = 1;
    while (box.w / Math.ceil(frame.m / rows) < 24 && rows < 4) rows++;
    const perRow = Math.ceil(frame.m / rows);
    const cell = Math.min(46, box.w / perRow);
    const band = box.h / rows;
    const head = Math.min(cell, 26, band * 0.3);
    const link = Math.min(8, head * 0.35);
    const item = Math.max(10, Math.min(head, (band - head - 10) / longest - link));
    const px = Math.max(8, Math.min(12, cell * 0.42));
    const left = box.x + (box.w - perRow * cell) / 2;
    const top =
      box.y + Math.max(0, (box.h - rows * band) / 2) + (rows === 1 ? Math.min(band * 0.15, 40) : 0);
    frame.chains.forEach((chain, i) => {
      const x = left + ((i % perRow) + 0.5) * cell;
      const y = top + Math.floor(i / perRow) * band + head / 2;
      const role = frame.hi.get(i);
      plate(ctx, { x, y }, cell - 3, head, {
        ...roleStyle(palette, role, px),
        fill: role ? tint(palette, roleColour(palette, role) ?? palette.faint, 0.3) : palette.faint,
        text: String(i),
        textColour: palette.ink,
        fontPx: Math.min(10, px),
      });
      let previous = y + head / 2;
      chain.forEach((entry, k) => {
        const cy = y + head / 2 + link + k * (item + link) + item / 2;
        const at = g.place(`key:${entry.id}`, x, cy);
        line(
          ctx,
          { x: at.x, y: k === 0 ? previous : at.y - item / 2 - link },
          { x: at.x, y: at.y - item / 2 },
          palette.muted,
        );
        previous = cy + item / 2;
        plate(ctx, at, cell - 5, item, {
          ...roleStyle(palette, entry.id === frame.cell ? (role ?? 'compare') : undefined, px),
          text: String(entry.key),
        });
      });
    });
  }

  demo.layout.panel.append(
    fieldset(
      'Table',
      select<HashScheme>({
        label: 'Collisions',
        options: SCHEMES,
        value: scheme(),
        onChange(id) {
          settings.scheme = id;
          demo.rebuild();
        },
      }).root,
      slider({
        label: 'Grow when load factor passes',
        min: 0.5,
        max: 0.9,
        step: 0.05,
        value: settings.load,
        format: (v) => v.toFixed(2),
        onInput(value) {
          settings.load = value;
          demo.rebuild();
        },
      }).root,
      presetSelect(demo, [
        { name: 'One cluster: keys that all hash to 3', ops: 'i3.i14.i25.i36.i47.i4.f47' },
        {
          name: 'Tombstones: delete, then find past the gap',
          ops: 'i3.i14.i25.i36.d14.d25.f36.i58.f58',
        },
        { name: 'Fill until the table grows', ops: 'i12.i45.i7.i88.i23.i56.i31.i64.i90.i100' },
        { name: 'Primary clustering: a run of neighbours', ops: 'i5.i6.i7.i16.i17.i27.i28' },
      ]),
    ),
    keyOpsFieldset(demo, { maxKey: MAX_KEY, keys: () => keys, maxKeys: MAX_KEYS }),
    demo.player.root,
    demo.history,
  );

  demo.layout.readout.append(
    counters.root,
    demo.status,
    legend([
      ['var(--canvas-compare)', 'Slot being probed'],
      ['var(--canvas-visit)', 'Probed earlier in this operation'],
      ['var(--canvas-change)', 'Written'],
      ['var(--canvas-good)', 'Found'],
    ]),
  );

  demo.layout.about.append(
    prose(
      'A hash table turns a key into a slot number, here `key mod m`, and looks there first. Two keys can land on the same slot. Open addressing resolves that inside the table by trying further slots in a fixed order; separate chaining keeps a short list in each slot instead.',
    ),
    formula(
      'linear probing      slot_i = (h + i) mod m\nquadratic probing   slot_i = (h + i²) mod m\ndouble hashing      slot_i = (h + i · h2) mod m,   h2 = 1 + (key mod (m − 1))',
    ),
    prose(
      'Linear probing is simple and kind to memory caches, but occupied slots clump into runs, and a longer run is more likely to be hit and grow again. Quadratic probing breaks up the runs, though keys with the same first slot still follow the same path, and it only reaches about half the slots of a prime-sized table. Double hashing gives each key its own step, so paths rarely coincide. A cross marks a tombstone: a deleted key whose slot must still count as occupied, or later searches would stop too early.',
    ),
    prose(
      'The load factor `α` is the fraction of slots in use, tombstones included. Probe counts rise steeply as it nears 1, so the table grows and rehashes every key once it passes a threshold. Rehashing costs `O(n)` but happens rarely enough that inserts stay `O(1)` on average.',
    ),
    formula(
      'expected probes, unsuccessful search\nlinear probing   ≈ (1 + 1 / (1 − α)²) / 2\ndouble hashing   ≈ 1 / (1 − α)\nchaining         ≈ 1 + α',
    ),
  );

  return demo.dispose;
};
