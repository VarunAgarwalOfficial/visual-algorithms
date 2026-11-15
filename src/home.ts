import { ALL_DEMOS, SECTIONS, searchDemos } from './demos/registry';
import type { DemoEntry } from './demos/layout';
import { el } from './ui/dom';

export const SITE_TITLE = 'Visual algorithms';

export interface Home {
  /** Shows only the demos matching the query and records it in the URL. */
  filter(query: string): void;
}

/** One picture per theme, made by scripts/thumbnails.sh. CSS shows the one in use; the other is never fetched. */
function thumbnail(demo: DemoEntry, theme: 'light' | 'dark'): HTMLImageElement {
  return el('img', {
    class: `thumb ${theme}`,
    src: `thumbs/${demo.id}-${theme}.webp`,
    alt: '',
    width: '400',
    height: '300',
    loading: 'lazy',
    decoding: 'async',
  });
}

function card(demo: DemoEntry): HTMLLIElement {
  return el(
    'li',
    {},
    el(
      'a',
      { class: 'card', href: `#/${demo.id}` },
      thumbnail(demo, 'light'),
      thumbnail(demo, 'dark'),
      el(
        'div',
        { class: 'card-text' },
        el('h3', { text: demo.title }),
        el('p', { text: demo.summary }),
      ),
    ),
  );
}

/** The grouped index of every demo. */
export function mountHome(root: HTMLElement, query: string): Home {
  const count = el('p', { class: 'count', role: 'status' });
  const empty = el('p', { class: 'empty', text: 'No demo matches. Try a shorter word.' });
  empty.hidden = true;

  const sections = SECTIONS.map((section) => {
    const cards = section.demos.map((demo) => ({ demo, node: card(demo) }));
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

  const filter = (text: string) => {
    const wanted = text.trim();
    const found = new Set(searchDemos(wanted));
    for (const { node, cards } of sections) {
      let shown = 0;
      for (const item of cards) {
        item.node.hidden = !found.has(item.demo);
        if (!item.node.hidden) shown++;
      }
      node.hidden = shown === 0;
    }
    empty.hidden = found.size > 0;
    count.textContent = wanted
      ? `${found.size} of ${ALL_DEMOS.length} demos match "${wanted}".`
      : '';
    const url = `${window.location.pathname}${window.location.search}#/${
      wanted ? `?q=${encodeURIComponent(wanted)}` : ''
    }`;
    window.history.replaceState(null, '', url);
  };

  root.append(
    el(
      'div',
      { class: 'home-head' },
      el('h1', { text: 'Algorithms you can watch' }),
      el('p', {
        class: 'lede',
        text: `${ALL_DEMOS.length} small demos, each showing one algorithm working on an example, one step at a time. Choose a picture below to open that demo; the first one, Sorting, is a good place to start. Each opens with its example ready and a Play button under it.`,
      }),
      count,
    ),
    empty,
    ...sections.map((s) => s.node),
  );

  if (query) filter(query);
  return { filter };
}

/** Shown for an address that names no demo. */
export function mountNotFound(root: HTMLElement, route: string): void {
  // Any demo that shares a word with the address, so a mistyped or outdated link still leads somewhere.
  const words = route.split(/[^a-z0-9]+/i).filter((word) => word.length > 2);
  const near = [...new Set(words.flatMap((word) => searchDemos(word)))].slice(0, 5);
  root.append(
    el(
      'div',
      { class: 'missing' },
      el('h1', { text: 'No such demo' }),
      el('p', { class: 'lede', text: `Nothing here is called "${route}".` }),
      near.length > 0 && el('p', { text: 'Perhaps one of these:' }),
      near.length > 0 &&
        el(
          'ul',
          {},
          ...near.map((d) => el('li', {}, el('a', { href: `#/${d.id}`, text: d.title }))),
        ),
      el('p', {}, el('a', { href: '#/', text: 'See all the demos' })),
    ),
  );
}
