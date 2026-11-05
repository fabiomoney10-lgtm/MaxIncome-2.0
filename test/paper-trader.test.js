'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool } = require('../src/paper-trader');

test('fails closed when DATABASE_URL is absent', () => {
  assert.throws(() => createPool(''), /DATABASE_URL não configurada/);
});
