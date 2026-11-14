import './style.css';
import { fourier } from './demos/fourier';
import type { Demo } from './demos/layout';
import { metaballs } from './demos/metaballs';
import { sorting } from './demos/sorting';
import { el } from './ui/dom';

const DEMOS: readonly Demo[] = [fourier, metaballs, sorting];
const SITE_TITLE = 'Visual algorithms';

function required(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Page shell is missing ${selector}`);
  return node;
}

const main = required('#main');
const nav = required('#nav');

const links = new Map<string, HTMLAnchorElement>();
for (const demo of DEMOS) {
  const link = el('a', { href: `#/${demo.id}`, text: demo.title });
  links.set(demo.id, link);
  nav.append(el('li', {}, link));
}

function mountHome(root: HTMLElement): () => void {
  root.append(
    el('h1', { text: SITE_TITLE }),
    el('p', {
      class: 'lede',
      text: 'Three small interactive demos. Each one shows an algorithm working, with the controls to slow it down and take it apart.',
    }),
    el(
      'ul',
      { class: 'cards' },
      ...DEMOS.map((demo) =>
        el(
          'li',
          {},
          el(
            'a',
            { class: 'card', href: `#/${demo.id}` },
            el('h2', { text: demo.title }),
            el('p', { text: demo.summary }),
          ),
        ),
      ),
    ),
  );
  return () => {};
}

let cleanup: (() => void) | undefined;
let first = true;

function route() {
  const id = window.location.hash.replace(/^#\/?/, '');
  const demo = DEMOS.find((d) => d.id === id);

  cleanup?.();
  main.replaceChildren();
  cleanup = demo ? demo.mount(main) : mountHome(main);

  document.title = demo ? `${demo.title} · ${SITE_TITLE}` : SITE_TITLE;
  for (const [linkId, link] of links) {
    if (linkId === demo?.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  // After a navigation, move focus to the new content so keyboard and
  // screen-reader users land on it. Not on first load, to leave the page top alone.
  if (!first) main.focus({ preventScroll: true });
  first = false;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
