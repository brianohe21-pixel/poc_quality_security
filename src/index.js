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

function evaluateArithmetic(expression) {
  const sanitized = String(expression ?? '1 + 1').trim();
  if (!/^[\d+\-*/().\s]+$/.test(sanitized)) {
    throw new Error('Invalid expression');
  }

  const normalized = sanitized.replace(/\s+/g, '');
  let index = 0;

  function parseNumber() {
    const start = index;
    while (index < normalized.length && /[\d.]/.test(normalized[index])) {
      index += 1;
    }
    if (start === index) {
      throw new Error('Invalid expression');
    }
    return Number(normalized.slice(start, index));
  }

  function parseFactor() {
    if (normalized[index] === '(') {
      index += 1;
      const value = parseExpression();
      if (normalized[index] !== ')') {
        throw new Error('Invalid expression');
      }
      index += 1;
      return value;
    }
    if (normalized[index] === '-') {
      index += 1;
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    while (index < normalized.length && (normalized[index] === '*' || normalized[index] === '/')) {
      const operator = normalized[index];
      index += 1;
      const right = parseFactor();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (index < normalized.length && (normalized[index] === '+' || normalized[index] === '-')) {
      const operator = normalized[index];
      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (index !== normalized.length) {
    throw new Error('Invalid expression');
  }
  return result;
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
    const result = evaluateArithmetic(expression);
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid expression' });
  }
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

module.exports = { app, buildQuery, buildQueryDuplicate, evaluateArithmetic };
