function createDefect({ id, reporterId, title, status = 'Open' }) {
  return {
    id,
    reporterId,
    title,
    status,
    history: [],
    lastTransitionAt: null,
  };
}

function applyTransition(defect, toStatus, at = new Date().toISOString()) {
  const fromStatus = defect.status;
  defect.status = toStatus;
  defect.lastTransitionAt = at;
  defect.history.push({ fromStatus, toStatus, at });
  return defect;
}

module.exports = { createDefect, applyTransition };
