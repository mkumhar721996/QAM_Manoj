// Matches the `access_token` field returned by POST /auth/login (see authController.ts),
// which is the value a real login flow persists to establish a client session.
export const SESSION_STORAGE_KEY = "access_token";

export const POSTS = [
  { author: "Priya Sharma", text: "Excited to try the new pizza builder!", timestamp: "2026-09-15T10:00:00Z" },
  { author: "Alex Chen", text: "Anyone up for pizza night this weekend?", timestamp: "2026-09-16T14:30:00Z" },
  { author: "Jordan Lee", text: "Just customised my first pizza on here.", timestamp: "2026-09-16T18:45:00Z" },
];

export function hasSession(storage) {
  return storage.getItem(SESSION_STORAGE_KEY) !== null;
}

export function clearSession(storage) {
  storage.removeItem(SESSION_STORAGE_KEY);
}

function appendPostField(document, article, testId, className, text) {
  const field = document.createElement("p");
  if (className) {
    field.className = className;
  }
  field.setAttribute("data-testid", testId);
  field.textContent = text;
  article.appendChild(field);
}

export function renderPosts(feedEl, document, posts = POSTS) {
  for (const post of posts) {
    const article = document.createElement("article");
    article.className = "card";
    article.setAttribute("data-testid", "post");
    appendPostField(document, article, "post-author", "text-bold", post.author);
    appendPostField(document, article, "post-text", "", post.text);
    appendPostField(document, article, "post-timestamp", "text-sm text-muted", post.timestamp);
    feedEl.appendChild(article);
  }
}

export function initHome({ document, storage, location }) {
  const homeView = document.querySelector('[data-testid="home-view"]');
  if (!hasSession(storage)) {
    location.assign("/login");
    return;
  }
  homeView.hidden = false;
  renderPosts(document.querySelector('[data-testid="post-feed"]'), document);
  document.querySelector('[data-testid="logout-button"]').addEventListener("click", () => {
    clearSession(storage);
    location.assign("/login");
  });
}
