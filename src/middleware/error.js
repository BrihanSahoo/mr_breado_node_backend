const { fail } = require('../utils/respond');
module.exports = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (process.env.NODE_ENV !== 'production') console.error(err);
  return fail(res, status === 500 ? 'Internal server error' : err.message, status, process.env.NODE_ENV === 'production' ? undefined : err.stack);
};
