import http from "node:http";
import { createApp } from "./app.ts";

const PORT = process.env.PORT || 8007;
const { requestListener } = createApp();

http.createServer(requestListener).listen(PORT, () => {
  console.log(`Auth service listening on port ${PORT}`);
});
