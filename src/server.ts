import http from "node:http";
import { createApp } from "./app.ts";

const PORT = process.env.PORT || 8007;
const { requestListener } = createApp();

const server = http.createServer(requestListener);

server.on("error", (err) => {
  console.error("failed to start server:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Auth service listening on port ${PORT}`);
});
