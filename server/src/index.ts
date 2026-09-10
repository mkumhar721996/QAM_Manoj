import { createServer } from "./app.ts";

const port = Number(process.env.ARC_DEV_PORT ?? 8001);

createServer().listen(port, () => {
  console.log(`Defect tracker API listening on port ${port}`);
});
