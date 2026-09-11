"use strict";

const { createApp } = require("./app.cjs");

const port = process.env.PORT || 3000;
const { server } = createApp({ tokenSecret: process.env.TOKEN_SECRET });

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
