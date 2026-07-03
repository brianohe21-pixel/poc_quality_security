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

function safeEvaluateExpression(input) {
  const expression = String(input ?? '').trim();
  if (!expression) {
    return 2;
  }
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error('Invalid expression');
  }

  let index = 0;

  function skipSpaces() {
    while (expression[index] === ' ') {
      index += 1;
    }
  }

  function parseNumber() {
    skipSpaces();
    const match = /^[0-9]+(?:\.[0-9]+)?/.exec(expression.slice(index));
    if (!match) {
      throw new Error('Invalid expression');
    }
    index += match[0].length;
    return Number(match[0]);
  }

  function parseFactor() {
    skipSpaces();
    if (expression[index] === '(') {
      index += 1;
      const value = parseExpression();
      skipSpaces();
      if (expression[index] !== ')') {
        throw new Error('Invalid expression');
      }
      index += 1;
      return value;
    }
    if (expression[index] === '-') {
      index += 1;
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    while (true) {
      skipSpaces();
      const op = expression[index];
      if (op === '*' || op === '/') {
        index += 1;
        const right = parseFactor();
        value = op === '*' ? value * right : value / right;
      } else {
        break;
      }
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const op = expression[index];
      if (op === '+' || op === '-') {
        index += 1;
        const right = parseTerm();
        value = op === '+' ? value + right : value - right;
      } else {
        break;
      }
    }
    return value;
  }

  const result = parseExpression();
  skipSpaces();
  if (index !== expression.length) {
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
  const expression = req.body.expression || '1 + 1';
  try {
    const result = safeEvaluateExpression(expression);
    res.json({ result });
  } catch {
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

module.exports = { app, buildQuery, buildQueryDuplicate, safeEvaluateExpression };
