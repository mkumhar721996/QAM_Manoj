const STATUSES = ['Open', 'Fixed', 'Reopened', 'Closed'];

const ALLOWED_TRANSITIONS = {
  Open: ['Fixed'],
  Fixed: ['Closed', 'Reopened'],
  Reopened: ['Fixed'],
  Closed: [],
};

function isValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

module.exports = { STATUSES, ALLOWED_TRANSITIONS, isValidTransition };
