import { createApp } from './app.js';
import { createStore } from './store.js';

const port = process.env.PORT || 3000;
const store = createStore();
const server = createApp(store);
server.listen(port, () => {
  console.log(`Auth server listening on port ${port}`);
});
