import { INPUT_KINDS, MAX_SIZE, makeInput, parseValues } from '../../core/sorting/inputs';
import { newSeed, seeded } from '../../core/random';
import { button, el, select, slider, textInput } from '../../ui/dom';

/** The URL keys both sorting demos use for their input. Spread into urlState defaults. */
export const INPUT_DEFAULTS = { input: 'random', n: 48, seed: 1, vals: '' };

export interface InputSettings {
  input: string;
  n: number;
  seed: number;
  /** The values of a custom input, joined with dots. Empty for presets. */
  vals: string;
}

const MIN_SIZE = 2;
const KINDS = [...INPUT_KINDS, { id: 'custom', name: 'Custom (typed or dragged)' }] as const;
type Kind = (typeof KINDS)[number]['id'];

export interface InputControls {
  /** The controls, to place in a fieldset. */
  nodes: HTMLElement[];
  /** The array to sort. */
  values(): number[];
  /** Replaces the input with these values, as when the user drags a bar. */
  setCustom(values: readonly number[]): void;
}

/**
 * Starting order, size, new array and a typed list of values. Keeps `settings`
 * valid (a hand-edited URL can hold anything) and calls `onChange` whenever the
 * array to sort changes.
 */
export function inputControls(settings: InputSettings, onChange: () => void): InputControls {
  const kind = (): Kind => KINDS.find((k) => k.id === settings.input)?.id ?? 'random';
  let current: number[] = [];

  function rebuild() {
    const id = kind();
    const custom = id === 'custom' ? parseValues(settings.vals) : undefined;
    if (custom) {
      current = custom;
    } else {
      settings.input = id === 'custom' ? 'random' : id;
      settings.vals = '';
      current = makeInput(kind() as Exclude<Kind, 'custom'>, settings.n, seeded(settings.seed));
    }
    settings.n = current.length;
  }

  function sync(fromText = false) {
    kindSelect.input.value = kind();
    sizeSlider.set(settings.n);
    if (!fromText) list.input.value = current.join(', ');
    error.hidden = true;
    onChange();
  }

  function setCustom(values: readonly number[], fromText = false) {
    current = [...values];
    settings.input = 'custom';
    settings.vals = current.join('.');
    settings.n = current.length;
    sync(fromText);
  }

  settings.n = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(settings.n)));
  settings.seed = Math.abs(Math.round(settings.seed)) % 1_000_000_000;
  rebuild();

  const kindSelect = select<Kind>({
    label: 'Starting order',
    options: KINDS,
    value: kind(),
    onChange(id) {
      if (id === 'custom') {
        setCustom(current);
      } else {
        settings.input = id;
        rebuild();
        sync();
      }
    },
  });
  const sizeSlider = slider({
    label: 'Number of bars',
    min: MIN_SIZE,
    max: MAX_SIZE,
    value: settings.n,
    onInput(size) {
      if (kind() === 'custom') {
        // Keep what the user made: cut it short, or pad it with random values.
        const random = seeded(settings.seed);
        const top = Math.max(size, ...current);
        const padded = Array.from(
          { length: size },
          (_, i) => current[i] ?? 1 + Math.floor(random() * top),
        );
        setCustom(padded);
      } else {
        settings.n = size;
        rebuild();
        sync();
      }
    },
  });
  const list = textInput({
    label: 'Values (comma-separated, 1 to 999)',
    value: current.join(', '),
    onChange(text) {
      const values = parseValues(text);
      if (values) setCustom(values, true);
      error.hidden = Boolean(values);
    },
  });
  const error = el('p', {
    class: 'note error',
    text: 'Type at least two whole numbers, separated by commas.',
  });
  error.hidden = true;
  const fresh = button('New array', () => {
    settings.seed = newSeed();
    if (kind() === 'custom') settings.input = 'random';
    rebuild();
    sync();
  });

  return {
    nodes: [kindSelect.root, sizeSlider.root, fresh, list.root, error],
    values: () => current,
    setCustom: (values) => setCustom(values),
  };
}
