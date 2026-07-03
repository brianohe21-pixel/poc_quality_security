const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildQuery, safeEvaluate, RUN_OUTPUT } = require('./index');

describe('buildQuery', () => {
  it('returns a SQL string with the provided user id', () => {
    const query = buildQuery('42');
    assert.equal(query, 'SELECT * FROM users WHERE id = 42');
  });
});

describe('RUN_OUTPUT', () => {
  it('uses a fixed response instead of executing shell commands', () => {
    assert.equal(RUN_OUTPUT, 'poc');
  });
});

describe('safeEvaluate', () => {
  it('evaluates simple arithmetic expressions', () => {
    assert.equal(safeEvaluate('2 + 3'), 5);
    assert.equal(safeEvaluate('10 - 4'), 6);
    assert.equal(safeEvaluate('3 * 7'), 21);
    assert.equal(safeEvaluate('8 / 2'), 4);
  });

  it('rejects invalid or unsafe expressions', () => {
    assert.equal(safeEvaluate('process.exit()'), null);
    assert.equal(safeEvaluate('1; eval("hack")'), null);
    assert.equal(safeEvaluate('8 / 0'), null);
  });
});
