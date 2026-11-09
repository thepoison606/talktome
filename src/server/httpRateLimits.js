const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { requestClientAddress } = require('./webAccess');

const HTTP_RATE_LIMITS = Object.freeze({
  all: { windowMs: 60_000, limit: 6000 },
  login: { windowMs: 15 * 60_000, limit: 30 },
  admin: { windowMs: 60_000, limit: 600 },
  control: { windowMs: 60_000, limit: 2400 },
});

function installHttpRateLimits(app, { getWebAccess = () => ({}), policies = HTTP_RATE_LIMITS } = {}) {
  // Use the same verified proxy chain as the Status page, not arbitrary
  // X-Forwarded-For values or an unrestricted Express `trust proxy` setting.
  const keyGenerator = req => ipKeyGenerator(
    requestClientAddress(req, getWebAccess()) || req.socket?.remoteAddress || 'unknown'
  );
  const makeLimiter = (name, options = {}) => rateLimit({
    ...policies[name],
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: `talktome-${name}`,
    requestPropertyName: `rateLimit_${name}`,
    message: { error: 'Too many requests. Please retry after the Retry-After interval.' },
    ...options,
  });
  const limiters = {
    all: makeLimiter('all'),
    login: makeLimiter('login', {
      skip: req => req.method !== 'POST',
      // Successful logins do not exhaust a shared studio/NAT address's quota.
      skipSuccessfulRequests: true,
    }),
    admin: makeLimiter('admin'),
    control: makeLimiter('control'),
  };
  // Install before JSON parsing, static file access and every HTTP route,
  // including /panel registered by remotePanelControl. Socket.IO media and
  // existing SSE streams are not per-message HTTP requests.
  app.use(limiters.all);
  app.use(['/login', '/admin/login', '/api/v1/companion/auth/login'], limiters.login);
  app.use(['/admin', '/users', '/feeds', '/conferences', '/panel'], limiters.admin);
  app.use('/api', limiters.control);
  return limiters;
}

module.exports = { HTTP_RATE_LIMITS, installHttpRateLimits };
