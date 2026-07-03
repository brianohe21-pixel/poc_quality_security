const express = require('express');
const _ = require('lodash');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const unusedConfig = { debug: true, retries: 3 };

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
  if (expression !== '1 + 1') {
    return res.status(400).json({ error: 'Only the default expression is supported' });
  }
  res.json({ result: 2 });
});

app.get('/merge', (req, res) => {
  const merged = _.merge({}, req.query);
  res.json(merged);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate };
