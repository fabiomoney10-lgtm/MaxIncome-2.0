'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('dashboard inline JavaScript parses successfully', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'dashboard script block exists');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
