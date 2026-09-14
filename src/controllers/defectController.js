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
      if (body.status !== undefined && body.status !== null && body.status !== 'Open') {
        return sendJson(res, 400, {
          error: "New defects must be created with status 'Open'",
        });
      }
      const defect = repository.create({
        reporterId: userId,
        title: body.title,
        status: 'Open',
      });
      console.log(
        JSON.stringify({
          event: 'defect_created',
          userId,
          defectId: defect.id,
          at: new Date().toISOString(),
        })
      );
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
      console.log(JSON.stringify({ event: 'defect_viewed', userId, defectId: id }));
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
      const fromStatus = defect.status;
      if (!isValidTransition(fromStatus, toStatus)) {
        return sendJson(res, 409, {
          error: `Cannot transition defect from '${fromStatus}' to '${toStatus}'`,
          defect,
        });
      }
      applyTransition(defect, toStatus);
      console.log(
        JSON.stringify({
          event: 'defect_transitioned',
          userId,
          defectId: id,
          fromStatus,
          toStatus,
          at: defect.lastTransitionAt,
        })
      );
      sendJson(res, 200, defect);
    },
  };
}

module.exports = { createDefectController };
