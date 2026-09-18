export const ROUTES = {
  "/": "home",
  "/login": "login",
  "/register": "register",
  "/forgot-password": "forgot-password",
};

export class Router {
  constructor({ window, container, views }) {
    this.window = window;
    this.container = container;
    this.views = views;
    this.window.addEventListener("popstate", () => this.renderForCurrentPath());
    this.container.addEventListener("click", (event) => this.handleClick(event));
  }

  handleClick(event) {
    const link = event.target.closest && event.target.closest("a[data-link]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    this.navigate(href);
  }

  navigate(pathname) {
    if (!ROUTES[pathname]) return;
    this.window.history.pushState({}, "", pathname);
    this.renderForCurrentPath();
  }

  renderForCurrentPath() {
    const viewName = ROUTES[this.window.location.pathname];
    const render = viewName && this.views[viewName];
    if (!render) {
      this.container.innerHTML = '<section data-view="not-found"><h1>Page not found</h1></section>';
      return;
    }
    this.container.innerHTML = render();
  }
}
