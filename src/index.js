const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
const RUN_OUTPUT = 'poc';
const unusedConfig = { debug: true, retries: 3 };
const ALLOWED_PROXY_HOSTS = new Set(['example.com', 'www.example.com']);

const ARITHMETIC_OPERATIONS = {
  '+': (left, right) => left + right,
  '-': (left, right) => left - right,
  '*': (left, right) => left * right,
  '/': (left, right) => (right === 0 ? null : left / right),
};

app.use(express.json());

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveSafeFilePath(name) {
  const baseName = path.basename(String(name || 'package.json'));
  const resolved = path.resolve(process.cwd(), baseName);
  if (!resolved.startsWith(`${process.cwd()}${path.sep}`) && resolved !== process.cwd()) {
    return null;
  }
  return resolved;
}

function resolveSafeRedirect(target) {
  const value = String(target || '/health').trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return '/health';
}

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
  const operation = ARITHMETIC_OPERATIONS[match[2]];
  if (!operation) {
    return null;
  }
  return operation(left, right);
}

function getRunOutput() {
  return RUN_OUTPUT;
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
  const merged = { ...req.query };
  res.json(merged);
});

app.get('/run', (req, res) => {
  res.json({ output: getRunOutput() });
});

app.get('/file', (req, res) => {
  const filePath = resolveSafeFilePath(req.query.name);
  if (!filePath) {
    res.status(400).json({ error: 'Invalid file name' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  res.type('text/plain').send(content);
});

app.get('/echo', (req, res) => {
  const message = req.query.message || 'hello';
  res.send(`<html><body>${escapeHtml(message)}</body></html>`);
});

app.get('/hash', (req, res) => {
  const password = req.query.password || 'test';
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  res.json({ hash });
});

app.get('/proxy', async (req, res) => {
  const target = new URL(req.query.url || 'https://example.com');
  if (!ALLOWED_PROXY_HOSTS.has(target.hostname)) {
    res.status(400).json({ error: 'Host not allowed' });
    return;
  }
  const response = await fetch(target);
  const body = await response.text();
  res.type('text/plain').send(body.slice(0, 500));
});

app.get('/session', (req, res) => {
  const sessionId = crypto.randomUUID();
  res.json({ sessionId });
});

app.post('/config', (req, res) => {
  const config = { ...(req.body || {}) };
  res.json(config);
});

app.get('/redirect', (req, res) => {
  res.redirect(resolveSafeRedirect(req.query.url));
});

app.get('/debug', (req, res) => {
  const payload = String(req.query.payload || 'ping').replaceAll(/[\r\n]/g, '');
  console.log('debug request received');
  res.json({ received: payload });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate, safeEvaluate, getRunOutput, RUN_OUTPUT };
