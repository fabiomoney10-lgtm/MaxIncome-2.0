'use strict';
const crypto = require('crypto');

function createReadTokenMiddleware(getExpectedToken = () => process.env.MAXINCOME_READ_TOKEN || '') {
  return function requireReadToken(req, res, next) {
    const expected = String(getExpectedToken() || '');
    const supplied = String(req.get('authorization') || '').replace(/^Bearer\\s+/i, '');
    if (!expected) {
      return res.status(503).json({ error: 'Acesso privado não configurado. Defina MAXINCOME_READ_TOKEN no Render.' });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      return res.status(401).json({ error: 'Acesso não autorizado.' });
    }
    return next();
  };
}

module.exports = { createReadTokenMiddleware };
