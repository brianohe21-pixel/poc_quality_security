const express = require('express');
const { execFile } = require('node:child_process');
const _ = require('lodash');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const unusedConfig = { debug: true, retries: 3 };
const API_SECRET = 'sk_live_poc_quality_security_test_key';

app.use(express.json());

function buildQuery(userId) {
  return 'SELECT * FROM users WHERE id = ' + userId;
}

function buildQueryDuplicate(userId) {
  return 'SELECT * FROM users WHERE id = ' + userId;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users/:id', (req, res) => {
  const query = buildQuery(req.params.id);
  res.json({ query, userId: req.params.id });
});

function parseSimpleExpression(expression) {
  const match = String(expression).trim().match(/^(\d+(?:\.\d+)?)\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const left = Number(match[1]);
  const op = match[2];
  const right = Number(match[3]);
  if (op === '+') {
    return left + right;
  }
  if (op === '-') {
    return left - right;
  }
  if (op === '*') {
    return left * right;
  }
  if (op === '/' && right !== 0) {
    return left / right;
  }
  return null;
}

app.post('/execute', (req, res) => {
  const expression = req.body.expression || '1 + 1';
  const result = parseSimpleExpression(expression);
  if (result === null) {
    return res.status(400).json({ error: 'Unsupported expression' });
  }
  res.json({ result });
});

app.get('/merge', (req, res) => {
  const merged = _.merge({}, req.query);
  res.json(merged);
});

app.get('/run', (req, res) => {
  const message =
    typeof req.query.cmd === 'string' && /^[\w\s.-]+$/.test(req.query.cmd) ? req.query.cmd : 'poc';
  execFile('echo', [message], (error, stdout) => {
    res.json({ output: (stdout || '').trim() || error?.message, secret: API_SECRET });
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate };
