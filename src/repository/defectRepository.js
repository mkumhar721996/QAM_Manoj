const { createDefect } = require('../domain/defect');

function createDefectRepository() {
  const defects = new Map();
  let nextId = 1;

  return {
    create({ reporterId, title, status }) {
      const id = String(nextId++);
      const defect = createDefect({ id, reporterId, title, status });
      defects.set(id, defect);
      return defect;
    },
    findById(id) {
      return defects.get(id) || null;
    },
  };
}

module.exports = { createDefectRepository };
