const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildQuery } = require('./index');

describe('buildQuery', () => {
  it('returns a SQL string with the provided user id', () => {
    const query = buildQuery('42');
    assert.equal(query, 'SELECT * FROM users WHERE id = 42');
  });
});
