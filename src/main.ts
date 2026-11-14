import './style.css';
import type { DemoEntry } from './demos/layout';
import { ALL_DEMOS, SECTIONS, searchDemos, sectionOf } from './demos/registry';
import { button, el } from './ui/dom';
import { setTheme, themeChoice, type ThemeChoice } from './ui/theme';
import { hashParams, hashRoute } from './ui/url';

const SITE_TITLE = 'Visual algorithms';

function required<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Page shell is missing ${selector}`);
  return node;
}

const main = required('#main');
const tools = required('#tools');

// --- Theme ---

const THEME_LABELS: Record<ThemeChoice, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'light', 'dark'];
const themeButton = button('', () => {
  setTheme(THEME_ORDER[(THEME_ORDER.indexOf(themeChoice()) + 1) % THEME_ORDER.length]);
  labelTheme();
});
themeButton.classList.add('quiet');
function labelTheme() {
  themeButton.textContent = `Theme: ${THEME_LABELS[themeChoice()]}`;
}
setTheme(themeChoice());
labelTheme();

// --- Search: filters the index on the home page, and is a jump menu everywhere ---

const search = el('input', {
  type: 'search',
  id: 'search',
  placeholder: 'Search demos',
  'aria-label': 'Search demos',
  autocomplete: 'off',
  role: 'combobox',
  'aria-expanded': 'false',
  'aria-controls': 'search-results',
});
const results = el('div', { id: 'search-results', class: 'results', role: 'listbox' });
results.hidden = true;
let active = -1;

function resultLinks(): HTMLAnchorElement[] {
  return [...results.querySelectorAll<HTMLAnchorElement>('a')];
}

function renderResults() {
  const found = new Set(searchDemos(search.value));
  results.replaceChildren();
  for (const section of SECTIONS) {
    const demos = section.demos.filter((d) => found.has(d));
    if (demos.length === 0) continue;
    results.append(
      el('p', { class: 'results-heading', text: section.title }),
      ...demos.map((d) => el('a', { href: `#/${d.id}`, role: 'option', text: d.title })),
    );
  }
  if (found.size === 0) results.append(el('p', { class: 'note', text: 'No demo matches.' }));
  setActive(search.value && found.size > 0 ? 0 : -1);
}

function setActive(index: number) {
  const links = resultLinks();
  active = links.length ? Math.max(-1, Math.min(links.length - 1, index)) : -1;
  links.forEach((link, i) => link.setAttribute('aria-selected', String(i === active)));
  links[active]?.scrollIntoView({ block: 'nearest' });
}

function openResults(open: boolean) {
  // On the home page the index itself is the result list.
  const show = open && hashRoute() !== '';
  results.hidden = !show;
  search.setAttribute('aria-expanded', String(show));
  if (show) renderResults();
}

search.addEventListener('focus', () => openResults(true));
search.addEventListener('input', () => {
  if (hashRoute() === '') filterHome(search.value);
  else openResults(true);
});
search.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (results.hidden) return;
    event.preventDefault();
    setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') {
    const target = results.hidden ? searchDemos(search.value)[0] : undefined;
    const link = resultLinks()[Math.max(0, active)];
    if (target) window.location.hash = `#/${target.id}`;
    else if (link && !results.hidden) window.location.hash = link.getAttribute('href') ?? '#/';
  } else if (event.key === 'Escape') {
    openResults(false);
    search.blur();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (event.target instanceof Node && !tools.contains(event.target)) openResults(false);
});
results.addEventListener('click', () => openResults(false));

// --- Keyboard shortcuts ---

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['/', 'Search demos'],
  ['Space or K', 'Play or pause'],
  ['→ or .', 'Step forward'],
  ['← or ,', 'Step back'],
  ['R', 'Reset'],
  ['[ and ]', 'Slower and faster'],
  ['N and P', 'Next and previous demo'],
  ['T', 'Switch theme'],
  ['H', 'Home'],
  ['?', 'Show this list'],
];
const help = el(
  'dialog',
  { class: 'help', 'aria-label': 'Keyboard shortcuts' },
  el('h2', { text: 'Keyboard shortcuts' }),
  el(
    'dl',
    {},
    ...SHORTCUTS.flatMap(([keys, what]) => [el('dt', { text: keys }), el('dd', { text: what })]),
  ),
  el('form', { method: 'dialog' }, el('button', { text: 'Close' })),
);
document.body.append(help);
const helpButton = button('Keys', () => help.showModal());
helpButton.classList.add('quiet');
helpButton.setAttribute('aria-label', 'Keyboard shortcuts');

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === '/') {
    event.preventDefault();
    search.focus();
    search.select();
  } else if (key === 't') themeButton.click();
  else if (key === '?') help.showModal();
  else if (key === 'h') window.location.hash = '#/';
  else if (key === 'n' || key === 'p') {
    const index = ALL_DEMOS.findIndex((d) => d.id === hashRoute());
    const next = ALL_DEMOS[index + (key === 'n' ? 1 : -1)];
    if (index >= 0 && next) window.location.hash = `#/${next.id}`;
  }
});

tools.append(el('div', { class: 'search' }, search, results), themeButton, helpButton);

// --- Home: the grouped index ---

let filterHome: (query: string) => void = () => {};

function mountHome(root: HTMLElement): () => void {
  const count = el('p', { class: 'note', role: 'status' });
  const sections = SECTIONS.filter((s) => s.demos.length > 0).map((section) => {
    const cards = section.demos.map((demo) => ({
      demo,
      node: el(
        'li',
        {},
        el(
          'a',
          { class: 'card', href: `#/${demo.id}` },
          el('h3', { text: demo.title }),
          el('p', { text: demo.summary }),
        ),
      ),
    }));
    const node = el(
      'section',
      { class: 'group', id: `section-${section.id}`, 'aria-labelledby': `heading-${section.id}` },
      el(
        'div',
        { class: 'group-head' },
        el('h2', { id: `heading-${section.id}`, text: section.title }),
        el('p', { text: section.blurb }),
      ),
      el('ul', { class: 'cards' }, ...cards.map((c) => c.node)),
    );
    return { section, node, cards };
  });

  const jump = el(
    'ul',
    { class: 'jump', 'aria-label': 'Sections' },
    ...sections.map(({ section, node }) => {
      const link = button(`${section.title} ${section.demos.length}`, () =>
        node.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
      link.classList.add('quiet');
      return el('li', {}, link);
    }),
  );

  filterHome = (query) => {
    const found = new Set(searchDemos(query));
    for (const { node, cards } of sections) {
      let shown = 0;
      for (const card of cards) {
        card.node.hidden = !found.has(card.demo);
        if (!card.node.hidden) shown++;
      }
      node.hidden = shown === 0;
    }
    count.textContent = query.trim()
      ? `${found.size} of ${ALL_DEMOS.length} demos match "${query.trim()}".`
      : '';
    const url = `${window.location.pathname}${window.location.search}#/${
      query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
    }`;
    window.history.replaceState(null, '', url);
  };

  root.append(
    el('h1', { text: SITE_TITLE }),
    el('p', {
      class: 'lede',
      text: `${ALL_DEMOS.length} interactive demos. Each one shows an algorithm working, with the controls to slow it down, step through it and change its input.`,
    }),
    jump,
    count,
    ...sections.map((s) => s.node),
  );

  const query = hashParams().get('q') ?? '';
  search.value = query;
  if (query) filterHome(query);
  return () => {
    filterHome = () => {};
  };
}

// --- Demo page chrome ---

function demoFooter(entry: DemoEntry): HTMLElement {
  const index = ALL_DEMOS.indexOf(entry);
  const link = (demo: DemoEntry | undefined, label: string) =>
    demo
      ? el(
          'a',
          { href: `#/${demo.id}`, class: label.toLowerCase() },
          el('span', { text: label }),
          demo.title,
        )
      : el('span');
  return el(
    'nav',
    { class: 'pager', 'aria-label': 'Neighbouring demos' },
    link(ALL_DEMOS[index - 1], 'Previous'),
    link(ALL_DEMOS[index + 1], 'Next'),
  );
}

// --- Router ---

let cleanup: (() => void) | undefined;
let first = true;
let visit = 0;

async function route() {
  const entry = ALL_DEMOS.find((d) => d.id === hashRoute());
  const mine = ++visit;

  cleanup?.();
  cleanup = undefined;
  main.replaceChildren();
  openResults(false);
  document.title = entry ? `${entry.title} · ${SITE_TITLE}` : SITE_TITLE;

  if (!entry) {
    cleanup = mountHome(main);
  } else {
    search.value = '';
    const section = sectionOf(entry.id);
    main.append(
      el(
        'p',
        { class: 'crumbs' },
        el('a', { href: '#/', text: 'All demos' }),
        ' / ',
        section?.title ?? '',
      ),
    );
    const body = el('div');
    main.append(body);
    try {
      const { mount } = await entry.load();
      if (mine !== visit) return; // the user moved on while the code loaded
      cleanup = mount(body, entry);
      main.append(demoFooter(entry));
    } catch (error) {
      if (mine !== visit) return;
      body.append(
        el('h1', { text: entry.title }),
        el('p', {
          class: 'note error',
          text: `This demo failed to load: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  // After a navigation, move focus to the new content so keyboard and
  // screen-reader users land on it. Not on first load, to leave the page top alone.
  if (!first) main.focus({ preventScroll: true });
  first = false;
  window.scrollTo(0, 0);
}

// Demos rewrite their own parameters with replaceState, which does not fire
// hashchange; a hashchange with the same route is the user editing parameters
// by hand, and a remount is the simplest way to honour them.
window.addEventListener('hashchange', () => void route());
void route();
