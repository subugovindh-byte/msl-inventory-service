// Simple hash-based client-side router
const routes = new Map();
let defaultRoute = null;

export function registerRoute(path, render) {
  routes.set(path, render);
}

export function setDefaultRoute(path) {
  defaultRoute = path;
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);

  // Avoid double-initial render:
  // - If we set `location.hash`, the browser will fire a `hashchange` which calls `handleRoute()`.
  // - But we also call `handleRoute()` below for the initial render.
  // On a cold load with no hash, that leads to the default view rendering twice.
  if (!location.hash && defaultRoute) {
    const newHash = '#' + defaultRoute;
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      // Replace URL without triggering hashchange.
      history.replaceState(null, '', newHash);
    } else {
      // Fallback: setting location.hash will trigger hashchange which will render.
      location.hash = newHash;
      return;
    }
  }

  handleRoute();
}

function handleRoute() {
  const root = document.getElementById('content');
  if (!root) return;
  const hash = location.hash.replace(/^#/, '');
  const [path, query] = hash.split('?');
  const render = routes.get(path) || (defaultRoute ? routes.get(defaultRoute) : null);
  if (!render) return;
  // Clear content
  while (root.firstChild) root.removeChild(root.firstChild);
  // Parse query params
  const params = {};
  if (query) {
    new URLSearchParams(query).forEach((v, k) => params[k] = v);
  }
  render(root, params);
}
