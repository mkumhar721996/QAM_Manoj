import http from "node:http";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import type { AppDependencies, App } from "../src/app.ts";

export interface TestServer {
  baseUrl: string;
  app: App;
  close: () => Promise<void>;
}

export function startTestServer(deps: AppDependencies = {}): Promise<TestServer> {
  const app = createApp(deps);
  const server: Server = http.createServer(app.requestListener);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        app,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
