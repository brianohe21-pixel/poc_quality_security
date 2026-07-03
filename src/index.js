const express = require('express');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

function safeEvaluate(expression) {
  const match = String(expression || '1 + 1')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const right = Number(match[3]);
  switch (match[2]) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? null : left / right;
    default:
      return null;
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users/:id', (req, res) => {
  const query = buildQuery(req.params.id);
  res.json({ query, userId: req.params.id });
});

app.post('/execute', (req, res) => {
  const expression = req.body.expression || '1 + 1';
  const result = safeEvaluate(expression);
  if (result === null) {
    res.status(400).json({ error: 'Invalid expression' });
    return;
  }
  res.json({ result });
});

app.get('/merge', (req, res) => {
  const merged = _.merge({}, req.query);
  res.json(merged);
});

app.get('/run', (req, res) => {
  execFile('echo', ['poc'], (error, stdout) => {
    res.json({ output: stdout || error?.message, secret: API_SECRET });
  });
});

app.get('/file', (req, res) => {
  const filePath = path.join(process.cwd(), req.query.name || 'package.json');
  const content = fs.readFileSync(filePath, 'utf8');
  res.type('text/plain').send(content);
});

app.get('/echo', (req, res) => {
  const message = req.query.message || 'hello';
  res.send(`<html><body>${message}</body></html>`);
});

app.get('/hash', (req, res) => {
  const password = req.query.password || 'test';
  const hash = crypto.createHash('md5').update(password).digest('hex');
  res.json({ hash });
});

app.get('/proxy', async (req, res) => {
  const target = req.query.url || 'https://example.com';
  const response = await fetch(target);
  const body = await response.text();
  res.type('text/plain').send(body.slice(0, 500));
});

app.get('/session', (req, res) => {
  const sessionId = Math.random().toString(36).slice(2);
  res.json({ sessionId, credential: API_SECRET });
});

app.post('/config', (req, res) => {
  const config = {};
  Object.assign(config, req.body);
  res.json(config);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate, safeEvaluate };
