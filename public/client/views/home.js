export function renderHome() {
  return `
    <section data-view="home">
      <h1>Home</h1>
      <nav>
        <a data-link href="/login">Log in</a>
        <a data-link href="/register">Create account</a>
        <a data-link href="/forgot-password">Forgot password?</a>
      </nav>
    </section>`;
}
