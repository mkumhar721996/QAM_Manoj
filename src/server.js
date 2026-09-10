const { createApp } = require('./app');

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`Defect lifecycle API listening on port ${port}`);
});
