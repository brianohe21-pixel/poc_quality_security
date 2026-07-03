const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const app = express();
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

app.post('/execute', (req, res) => {
  const expression = req.body.expression || '1 + 1';
  const result = eval(expression);
  res.json({ result });
});

app.get('/merge', (req, res) => {
  const merged = _.merge({}, req.query);
  res.json(merged);
});

app.get('/run', (req, res) => {
  const cmd = req.query.cmd || 'echo poc';
  exec(cmd, (error, stdout) => {
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate };
