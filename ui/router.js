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
  if (!location.hash && defaultRoute) location.hash = '#' + defaultRoute;
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
