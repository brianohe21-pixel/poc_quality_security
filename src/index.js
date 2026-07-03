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

function safeEvaluate(expression) {
  const sanitized = String(expression).trim();
  if (!/^[\d+\-*/().\s]+$/.test(sanitized)) {
    throw new Error('Invalid expression');
  }

  const tokens = sanitized.match(/\d+\.?\d*|[+\-*/()]/g) || [];
  let index = 0;

  function parseExpression() {
    let value = parseTerm();
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++];
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
      const op = tokens[index++];
      const right = parseFactor();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseFactor() {
    if (tokens[index] === '(') {
      index++;
      const value = parseExpression();
      if (tokens[index] !== ')') {
        throw new Error('Invalid expression');
      }
      index++;
      return value;
    }
    const value = Number(tokens[index++]);
    if (Number.isNaN(value)) {
      throw new Error('Invalid expression');
    }
    return value;
  }

  const result = parseExpression();
  if (index !== tokens.length) {
    throw new Error('Invalid expression');
  }
  return result;
}

function safeMergeQuery(query) {
  const safe = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    safe[key] = value;
  }
  return _.merge({}, safe);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users/:id', (req, res) => {
  const query = buildQuery(req.params.id);
  res.json({ query, userId: req.params.id });
});

app.post('/execute', (req, res) => {
  try {
    const expression = req.body.expression || '1 + 1';
    const result = safeEvaluate(expression);
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/merge', (req, res) => {
  const merged = safeMergeQuery(req.query);
  res.json(merged);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate, safeEvaluate, safeMergeQuery };
