import { knapsack, type Item, type KnapsackResult } from '../../core/strings/dp';
import { newSeed, randomInt, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider, textInput } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { mix, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';
import { drawTable, FONT, phases, type Cell } from './table';

const MAX_ITEMS = 6;
const MAX_CAPACITY = 15;
const MAX_WEIGHT = 9;
const MAX_VALUE = 30;
const PRESETS = [
  { id: 'classic', name: 'Classic four items', items: '1:1, 3:4, 4:5, 5:7', capacity: 7 },
  { id: 'greedy', name: 'Greedy by ratio fails', items: '5:10, 4:7, 4:7', capacity: 8 },
  { id: 'gems', name: 'Many small or one big', items: '2:3, 2:3, 2:3, 3:5, 7:12', capacity: 9 },
  {
    id: 'repeat',
    name: 'Worth repeating (try unbounded)',
    items: '1:1, 3:5, 4:6, 6:8',
    capacity: 12,
  },
] as const;

/** Reads "weight:value" pairs, ignoring anything half-typed or out of range. */
function parseItems(text: string): Item[] {
  const items: Item[] = [];
  for (const token of text.split(/[,;\s]+/)) {
    const match = /^(\d{1,3})[:/](\d{1,3})$/.exec(token);
    if (!match) continue;
    const weight = Number(match[1]);
    const value = Number(match[2]);
    if (weight < 1 || value < 1) continue;
    items.push({ weight: Math.min(MAX_WEIGHT, weight), value: Math.min(MAX_VALUE, value) });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

const formatItems = (items: readonly Item[]) =>
  items.map((item) => `${item.weight}:${item.value}`).join(', ');

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Knapsack table with one row per item and one column per capacity, and the packed knapsack drawn as a bar underneath.',
  );

  const url = urlState({ items: '1:1, 3:4, 4:5, 5:7', cap: 7, unbounded: false, speed: 8 });
  const settings = url.state;
  settings.cap = Math.max(1, Math.min(MAX_CAPACITY, Math.round(settings.cap)));
  let items = parseItems(settings.items);
  settings.items = formatItems(items);

  let result: KnapsackResult = knapsack([], 0);
  let fillSteps = 0;
  let position = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  const counters = stats({
    cells: 'Cells filled',
    best: 'Best value',
    weight: 'Weight packed',
  });
  const status = el('p', { class: 'note', style: 'flex-basis: 100%' });
  const answer = el('p', { class: 'note', style: 'flex-basis: 100%' });

  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 200,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(at) {
      position = at;
      update();
    },
  });

  const columns = () => settings.cap + 1;
  const cellOf = (step: number): Cell => [Math.floor(step / columns()) + 1, step % columns()];
  const backSteps = () => result.path.length - 1;
  const itemColour = (index: number) => theme.palette.series[index % theme.palette.series.length];

  function rebuild() {
    result = knapsack(items, settings.cap, settings.unbounded);
    fillSteps = items.length * columns();
    url.save();
    player.setLength(fillSteps + backSteps());
  }

  /** Items found after `back` traceback steps, in the order they were found. */
  function packedAfter(back: number): number[] {
    const found: number[] = [];
    for (let k = 0; k < back; k++) {
      const [i, w] = result.path[k];
      if (result.take[i][w]) found.push(i - 1);
    }
    return found;
  }

  function describe(): string {
    const { filled, back } = phases(position, fillSteps);
    const T = result.table;
    const from = settings.unbounded ? 0 : 1;
    if (items.length === 0) return 'No items: type some as weight:value pairs.';
    if (back > 0) {
      const [i, w] = result.path[back - 1];
      const item = items[i - 1];
      if (result.take[i][w])
        return `Back from D[${i}][${w}] = ${T[i][w]}: larger than D[${i - 1}][${w}] = ${T[i - 1][w]}, so item ${i} was taken. Go to D[${i - from}][${w - item.weight}] with ${w - item.weight} capacity left.`;
      return `Back from D[${i}][${w}] = ${T[i][w]}: same as D[${i - 1}][${w}], so item ${i} was ${back >= 2 && result.path[back - 2][0] === i ? 'not taken again' : 'skipped'}. Move up.`;
    }
    if (filled === 0) return 'Row 0 is all zeros: with no items the knapsack holds nothing.';
    const [i, w] = cellOf(filled - 1);
    const { weight, value } = items[i - 1];
    const what = `Item ${i} (weight ${weight}, value ${value}) at capacity ${w}`;
    if (weight > w)
      return `${what}: does not fit, so D[${i}][${w}] = D[${i - 1}][${w}] = ${T[i][w]}.`;
    const skip = T[i - 1][w];
    const take = T[i - from][w - weight] + value;
    return `${what}: D[${i}][${w}] = max(skip D[${i - 1}][${w}] = ${skip}, take D[${i - from}][${w - weight}] + ${value} = ${take}) = ${T[i][w]}. ${take > skip ? 'Take' : 'Skip'}.`;
  }

  function update() {
    draw();
    const { filled, back } = phases(position, fillSteps);
    const done = position >= player.length;
    const packed = packedAfter(back);
    counters.set({
      cells: `${filled} / ${fillSteps}`,
      best: filled >= fillSteps ? result.best : '–',
      weight:
        back > 0 || done
          ? `${packed.reduce((sum, i) => sum + items[i].weight, 0)} / ${settings.cap}`
          : '–',
    });
    status.textContent = describe();
    if (done && items.length > 0) {
      const names = [...new Set(result.chosen)].map((i) => {
        const copies = result.chosen.filter((c) => c === i).length;
        return `item ${i + 1}${copies > 1 ? ` ×${copies}` : ''}`;
      });
      const weight = result.chosen.reduce((sum, i) => sum + items[i].weight, 0);
      answer.textContent =
        result.chosen.length === 0
          ? 'Nothing fits: best value 0.'
          : `Best value ${result.best} with ${names.join(', ')}: weight ${weight} of ${settings.cap}.`;
    } else answer.textContent = '';
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const pad = Math.max(6, width * 0.02);
    const { filled, back } = phases(position, fillSteps);
    const cols = columns();
    const stripH = height * 0.2;
    const from = settings.unbounded ? 0 : 1;

    const current =
      back === 0 && filled > 0 && filled <= fillSteps && position < player.length
        ? cellOf(filled - 1)
        : undefined;
    const reads: Cell[] = [];
    if (current) {
      const [i, w] = current;
      reads.push([i - 1, w]);
      if (items[i - 1].weight <= w) reads.push([i - from, w - items[i - 1].weight]);
    }
    drawTable(ctx, palette, {
      x: pad,
      y: pad,
      w: width - 2 * pad,
      h: height - stripH - 2 * pad,
      rowHead: ['no items', ...items.map((item, i) => `${i + 1}: w${item.weight} v${item.value}`)],
      colHead: Array.from({ length: cols }, (_, w) => String(w)),
      headWidth: 2.6,
      value: (r, c) =>
        r === 0 || (r - 1) * cols + c < filled ? String(result.table[r][c]) : undefined,
      current,
      reads,
      path: back > 0 ? result.path.slice(0, back + 1) : [],
      mark: (r, c) => (r > 0 && result.take[r][c] ? itemColour(r - 1) : undefined),
      rowColour: (r) => (r > 0 ? itemColour(r - 1) : undefined),
    });

    // The knapsack as a bar, one unit of width per unit of capacity.
    const labelW = Math.min(70, width * 0.2);
    const barX = pad + labelW;
    const barW = width - 2 * pad - labelW;
    const barH = Math.min(34, stripH * 0.5);
    const barY = height - stripH + (stripH - barH) * 0.45;
    const unit = barW / settings.cap;
    const size = Math.max(8, Math.min(12, barH * 0.42));

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText('Knapsack', pad, barY + barH / 2);

    // While filling, shade the part of the knapsack the current cell may use.
    const [, w] = current ?? [0, 0];
    if (current && w > 0) {
      ctx.fillStyle = mix(palette.bg, palette.change, 0.22);
      ctx.fillRect(barX, barY, unit * w, barH);
    }
    let x = barX;
    ctx.textAlign = 'center';
    for (const index of packedAfter(back)) {
      const item = items[index];
      const blockW = unit * item.weight;
      ctx.fillStyle = mix(palette.bg, itemColour(index), 0.55);
      ctx.fillRect(x, barY, blockW, barH);
      ctx.strokeStyle = itemColour(index);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, barY + 0.75, blockW - 1.5, barH - 1.5);
      ctx.fillStyle = palette.ink;
      const label = blockW > size * 4.4 ? `${index + 1}: v${item.value}` : String(index + 1);
      ctx.fillText(label, x + blockW / 2, barY + barH / 2);
      x += blockW;
    }
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
    ctx.beginPath();
    for (let k = 1; k < settings.cap; k++) {
      ctx.moveTo(barX + unit * k, barY + barH);
      ctx.lineTo(barX + unit * k, barY + barH + 3);
    }
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = `${Math.max(7, size * 0.85)}px ${FONT}`;
    ctx.fillText('0', barX, barY + barH + size);
    ctx.fillText(String(settings.cap), barX + barW, barY + barH + size);
    if (current && w > 0 && w < settings.cap) {
      ctx.fillStyle = palette.change;
      ctx.fillText(String(w), barX + unit * w, barY + barH + size);
    }
  }

  // --- Controls ---

  const presetOf = () =>
    PRESETS.find((p) => p.items === settings.items && p.capacity === settings.cap)?.id ?? 'custom';
  const hint = el('p', { class: 'note' });
  const showHint = () => {
    hint.textContent = `${items.length} of up to ${MAX_ITEMS} items read. Weights 1 to ${MAX_WEIGHT}, values 1 to ${MAX_VALUE}.`;
  };
  const itemsInput = textInput({
    label: 'Items as weight:value',
    value: settings.items,
    maxLength: 80,
    onChange(value) {
      // Keep what the user typed in the box; only the parsed list is stored.
      items = parseItems(value);
      settings.items = formatItems(items);
      preset.input.value = presetOf();
      showHint();
      rebuild();
    },
  });
  const setItems = (next: Item[], capacity = settings.cap) => {
    items = next.slice(0, MAX_ITEMS);
    settings.items = itemsInput.input.value = formatItems(items);
    settings.cap = capacity;
    capacitySlider.set(capacity);
    preset.input.value = presetOf();
    showHint();
    rebuild();
  };
  const capacitySlider = slider({
    label: 'Capacity',
    min: 1,
    max: MAX_CAPACITY,
    value: settings.cap,
    onInput(value) {
      settings.cap = value;
      preset.input.value = presetOf();
      rebuild();
    },
  });
  const preset = select<string>({
    label: 'Preset',
    options: [...PRESETS, { id: 'custom', name: 'Custom' }],
    value: presetOf(),
    onChange(id) {
      const found = PRESETS.find((p) => p.id === id);
      if (found) setItems(parseItems(found.items), found.capacity);
    },
  });
  const randomItem = (random: () => number): Item => {
    const weight = randomInt(random, 1, 6);
    return { weight, value: Math.max(1, weight + randomInt(random, -1, 4)) };
  };

  panel.append(
    fieldset(
      'Items',
      itemsInput.root,
      hint,
      el(
        'div',
        { class: 'buttons' },
        button('Add item', () => {
          if (items.length < MAX_ITEMS) setItems([...items, randomItem(seeded(newSeed()))]);
        }),
        button('Remove last', () => setItems(items.slice(0, -1))),
        button('Randomise', () => {
          const random = seeded(newSeed());
          const count = randomInt(random, 3, 5);
          setItems(
            Array.from({ length: count }, () => randomItem(random)),
            randomInt(random, 6, 12),
          );
        }),
      ),
      preset.root,
      capacitySlider.root,
      checkbox({
        label: 'Unbounded (any number of each item)',
        checked: settings.unbounded,
        onChange(checked) {
          settings.unbounded = checked;
          rebuild();
        },
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    answer,
    legend([
      ['var(--canvas-change)', 'Cell being computed'],
      ['var(--canvas-compare)', 'Cells it reads (skip above, take to the left)'],
      ['var(--canvas-good)', 'Traceback'],
      ['var(--canvas-muted)', 'Corner mark: taking the row’s item is better here'],
    ]),
  );

  about.append(
    prose(
      'Each item has a weight and a value, and the knapsack has a weight limit. Pick a subset with the largest total value that fits. Taking the best value-per-weight items first can fail, as the second preset shows, so every item gets a real take-or-skip decision.',
    ),
    formula(
      'D[0][w] = 0\nD[i][w] = D[i-1][w]                                    if weight[i] > w\n        = max( D[i-1][w],                               skip item i\n               D[i-1][w - weight[i]] + value[i] )       take item i\n\nUnbounded: the take case reads D[i][w - weight[i]], the same row, so item i can be used again.',
    ),
    prose(
      '`D[i][w]` is the best value using only the first `i` items within capacity `w`. Each cell reads the cell above it and one cell further left in the row above, so the table is filled in `O(nW)` time for `n` items and capacity `W`. That is fast when `W` is small, but `W` is a number, not an input size: the problem is NP-hard in general.',
    ),
    prose(
      'The bottom right cell is the answer. To see which items it used, walk up from it: where a cell differs from the one above, that row’s item was taken, so jump left by its weight. The bar under the table fills with the items as they are found.',
    ),
  );

  showHint();
  rebuild();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
