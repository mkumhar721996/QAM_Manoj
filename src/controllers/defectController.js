const { authenticate } = require('../middleware/auth');
const { isValidTransition } = require('../domain/statusTransitions');
const { applyTransition } = require('../domain/defect');
const { sendJson } = require('../utils/http');

function createDefectController(repository) {
  return {
    create(req, res, body) {
      const userId = authenticate(req);
      if (!userId) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
      const defect = repository.create({
        reporterId: body.reporterId || userId,
        title: body.title,
        status: body.status,
      });
      sendJson(res, 201, defect);
    },

    get(req, res, id) {
      const userId = authenticate(req);
      if (!userId) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
      const defect = repository.findById(id);
      if (!defect) {
        return sendJson(res, 404, { error: 'Defect not found' });
      }
      sendJson(res, 200, defect);
    },

    transition(req, res, id, body) {
      const userId = authenticate(req);
      if (!userId) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
      const defect = repository.findById(id);
      if (!defect) {
        return sendJson(res, 404, { error: 'Defect not found' });
      }
      const { toStatus } = body;
      if (!isValidTransition(defect.status, toStatus)) {
        return sendJson(res, 409, {
          error: `Cannot transition defect from '${defect.status}' to '${toStatus}'`,
          defect,
        });
      }
      applyTransition(defect, toStatus);
      sendJson(res, 200, defect);
    },
  };
}

module.exports = { createDefectController };
