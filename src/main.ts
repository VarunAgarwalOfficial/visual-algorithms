import './style.css';
import { arrangeDemo, type DemoEntry } from './demos/layout';
import { ALL_DEMOS, SECTIONS, searchDemos, sectionOf } from './demos/registry';
import { SITE_TITLE, mountHome, mountNotFound, type Home } from './home';
import { button, el } from './ui/dom';
import { isDark, setTheme } from './ui/theme';
import { hashParams, hashRoute } from './ui/url';

function required<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Page shell is missing ${selector}`);
  return node;
}

const main = required('#main');
const tools = required('#tools');

// The skip link must not change the hash, which is the route.
required('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});

// --- Theme: the page follows the system setting; a host page that embeds it decides the rest. ---

const themeColour = document.querySelector('meta[name="theme-color"]');
function paintChrome() {
  // The browser's own chrome (address bar on a phone) follows the page.
  themeColour?.setAttribute('content', isDark() ? '#1a1918' : '#f6f5f2');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintChrome);
setTheme('auto');
paintChrome();

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
  const show = open && !home;
  results.hidden = !show;
  search.setAttribute('aria-expanded', String(show));
  if (show) renderResults();
}

search.addEventListener('focus', () => openResults(true));
search.addEventListener('input', () => {
  if (home) home.filter(search.value);
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
const helpButton = button('Keyboard shortcuts', () => help.showModal());
helpButton.classList.add('quiet', 'keys');
document.querySelector('.site-footer')?.append(helpButton);

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
  } else if (key === '?') help.showModal();
  else if (key === 'h') window.location.hash = '#/';
  else if (key === 'n' || key === 'p') {
    const index = ALL_DEMOS.findIndex((d) => d.id === hashRoute());
    const next = ALL_DEMOS[index + (key === 'n' ? 1 : -1)];
    if (index >= 0 && next) window.location.hash = `#/${next.id}`;
  }
});

tools.append(el('div', { class: 'search' }, search, results));

/** Set while the home page is showing: there the index itself is the result list. */
let home: Home | undefined;

// --- Demo page chrome ---

/** Copies the address, which already holds the demo's settings and input. */
function copyLinkButton(): HTMLButtonElement {
  const copy = button('Copy link', () => {
    // Wait a moment for a pending write of the settings into the URL.
    window.setTimeout(() => {
      navigator.clipboard?.writeText(window.location.href).then(
        () => flash('Copied'),
        () => flash('Copy failed'),
      );
    }, 250);
  });
  copy.classList.add('quiet');
  const flash = (text: string) => {
    copy.textContent = text;
    window.setTimeout(() => (copy.textContent = 'Copy link'), 1500);
  };
  return copy;
}

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
  home = undefined;
  main.replaceChildren();
  openResults(false);
  const missing = !entry && hashRoute() !== '';
  document.title = entry
    ? `${entry.title} · ${SITE_TITLE}`
    : missing
      ? `Not found · ${SITE_TITLE}`
      : SITE_TITLE;

  if (missing) {
    search.value = '';
    mountNotFound(main, hashRoute());
  } else if (!entry) {
    const query = hashParams().get('q') ?? '';
    search.value = query;
    home = mountHome(main, query);
  } else {
    search.value = '';
    const section = sectionOf(entry.id);
    const body = el('div');
    main.append(body);
    try {
      const { mount } = await entry.load();
      if (mine !== visit) return; // the user moved on while the code loaded
      cleanup = mount(body, entry);
      arrangeDemo(body);
      // Where this demo sits, and the link to it, come after the demo rather than before it.
      main.append(
        el(
          'div',
          { class: 'crumbs' },
          el(
            'p',
            {},
            el('a', { href: '#/', text: 'All demos' }),
            ` / ${section?.title ?? ''} / ${entry.title}`,
          ),
          copyLinkButton(),
        ),
        demoFooter(entry),
      );
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
