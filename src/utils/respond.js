function ok(res, data = null, message = 'Success', status = 200, extra = {}) { return res.status(status).json({ success: true, message, data, ...extra }); }
function fail(res, message = 'Something went wrong', status = 400, details) { return res.status(status).json({ success: false, message, ...(details ? { details } : {}) }); }
module.exports = { ok, fail };
