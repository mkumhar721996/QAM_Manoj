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
    event.preventDefault();
    this.navigate(link.getAttribute("href"));
  }

  navigate(pathname) {
    this.window.history.pushState({}, "", pathname);
    this.renderForCurrentPath();
  }

  renderForCurrentPath() {
    const viewName = ROUTES[this.window.location.pathname];
    this.container.innerHTML = this.views[viewName]();
  }
}
