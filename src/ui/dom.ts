type Child = Node | string | null | undefined | false;

/** Creates an element with attributes and children. `class` and `text` are shorthands. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

let nextId = 0;
const uid = (prefix: string) => `${prefix}-${++nextId}`;

export interface Slider {
  root: HTMLElement;
  input: HTMLInputElement;
  /** Sets the value and label without firing onInput. */
  set(value: number): void;
}

export function slider(options: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}): Slider {
  const id = uid('range');
  const format = options.format ?? String;
  const output = el('output', { for: id, text: format(options.value) });
  const input = el('input', {
    id,
    type: 'range',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step ?? 1),
    value: String(options.value),
  });
  const sync = () => {
    output.textContent = format(input.valueAsNumber);
    input.setAttribute('aria-valuetext', output.textContent);
  };
  sync();
  input.addEventListener('input', () => {
    sync();
    options.onInput(input.valueAsNumber);
  });
  const root = el(
    'div',
    { class: 'field' },
    el('div', { class: 'row' }, el('label', { for: id, text: options.label }), output),
    input,
  );
  return {
    root,
    input,
    set(value) {
      input.value = String(value);
      sync();
    },
  };
}

export function checkbox(options: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): HTMLLabelElement {
  const input = el('input', { type: 'checkbox' });
  input.checked = options.checked;
  input.addEventListener('change', () => options.onChange(input.checked));
  return el('label', { class: 'check' }, input, options.label);
}

export function select<T extends string>(options: {
  label: string;
  options: readonly { id: T; name: string }[];
  value: T;
  onChange: (value: T) => void;
}): { root: HTMLElement; input: HTMLSelectElement } {
  const id = uid('select');
  const input = el('select', { id });
  for (const option of options.options) {
    input.append(el('option', { value: option.id, text: option.name }));
  }
  input.value = options.value;
  input.addEventListener('change', () => options.onChange(input.value as T));
  const root = el('div', { class: 'field' }, el('label', { for: id, text: options.label }), input);
  return { root, input };
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = el('button', { type: 'button', class: className, text: label });
  node.addEventListener('click', onClick);
  return node;
}

export function fieldset(legend: string, ...children: Child[]): HTMLFieldSetElement {
  return el('fieldset', {}, el('legend', { text: legend }), ...children);
}
