'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadTokenMiddleware } = require('../src/read-token');

function invoke(middleware, authorization) {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const req = { get: name => name.toLowerCase() === 'authorization' ? authorization : undefined };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  middleware(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

test('private read endpoints fail closed when token is not configured', () => {
  const result = invoke(createReadTokenMiddleware(() => ''), 'Bearer any-value');
  assert.equal(result.statusCode, 503);
  assert.equal(result.nextCalled, false);
});

test('private read endpoints reject missing or incorrect bearer tokens', () => {
  const middleware = createReadTokenMiddleware(() => 'test-only-secret-32-chars-minimum');
  assert.equal(invoke(middleware, undefined).statusCode, 401);
  assert.equal(invoke(middleware, 'Bearer wrong-token').statusCode, 401);
  assert.equal(invoke(middleware, 'test-only-secret-32-chars-minimum').statusCode, 401);
});

test('private read endpoints accept the exact bearer token', () => {
  const middleware = createReadTokenMiddleware(() => 'test-only-secret-32-chars-minimum');
  const result = invoke(middleware, 'Bearer test-only-secret-32-chars-minimum');
  assert.equal(result.statusCode, null);
  assert.equal(result.nextCalled, true);
});
