/* MusicBox — nav: hash router. Refresh, back/forward, and deep links all
   land on the right page; focus moves to the page heading and the change
   is announced for screen readers. */

const PAGE_TITLES = {
  home: 'Home',
  journal: 'Journal',
  collections: 'Collections',
  collection: 'Collection',
  discover: 'Discover',
  stats: 'Stats',
  detail: 'Song detail',
};

let onRoute = null;

export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = hash.split('/');
  if (!head) return { page: 'home' };
  if (head === 'journal' && rest[0] === 'collections') return { page: 'journal', tab: 'collections' };
  if (head === 'journal') return { page: 'journal', tab: 'songs' };
  if (head === 'song' && rest[0]) return { page: 'detail', id: decodeURIComponent(rest[0]) };
  if (head === 'collection' && rest[0]) return { page: 'collection', id: decodeURIComponent(rest[0]) };
  if (['discover', 'stats'].includes(head)) return { page: head };
  return { page: 'home' };
}

export function navigate(path) {
  const target = '#/' + path.replace(/^#?\/?/, '');
  if (location.hash === target) {
    applyRoute(); // re-render same route
  } else {
    location.hash = target;
  }
}

export function goBack(fallback = 'journal') {
  if (history.length > 1) history.back();
  else navigate(fallback);
}

function applyRoute(moveFocus = true) {
  const route = parseRoute();

  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.dataset.page === route.page));

  // nav highlight (top links + mobile tabbar)
  const navKey = route.page === 'collection' ? 'journal'
    : route.page === 'detail' ? 'journal'
    : route.page;
  document.querySelectorAll('[data-nav]').forEach(l =>
    l.classList.toggle('active', l.dataset.nav === navKey));

  if (onRoute) onRoute(route);

  window.scrollTo({ top: 0 });

  const title = PAGE_TITLES[route.page] || 'Home';
  document.title = `${title} · MusicBox`;
  const announcer = document.getElementById('routeAnnouncer');
  if (announcer) announcer.textContent = `${title} page`;

  if (moveFocus) {
    const activePage = document.querySelector('.page.active');
    const heading = activePage && activePage.querySelector('[data-page-heading], h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
}

export function initRouter(handler) {
  onRoute = handler;
  window.addEventListener('hashchange', () => applyRoute());
  applyRoute(false); // initial render without focus-stealing
}
