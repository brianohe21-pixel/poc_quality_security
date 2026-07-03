const express = require('express');
const { spawn } = require('node:child_process');
const _ = require('lodash');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const unusedConfig = { debug: true, retries: 3 };
const API_SECRET = 'sk_live_poc_quality_security_test_key';

const ALLOWED_COMMANDS = {
  'echo poc': ['echo', 'poc'],
};

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeEvaluate(expression) {
  const sanitized = String(expression).trim();
  if (!/^[\d+\-*/().\s]+$/.test(sanitized)) {
    throw new Error('Invalid expression');
  }
  const tokens = sanitized.match(/\d+\.?\d*|[+\-*/()]/g);
  if (!tokens || tokens.join('') !== sanitized.replace(/\s/g, '')) {
    throw new Error('Invalid expression');
  }
  let index = 0;

  function parseNumber() {
    const token = tokens[index++];
    const value = Number(token);
    if (Number.isNaN(value)) {
      throw new Error('Invalid number');
    }
    return value;
  }

  function parseFactor() {
    if (tokens[index] === '(') {
      index++;
      const value = parseExpression();
      if (tokens[index] !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      index++;
      return value;
    }
    if (tokens[index] === '-') {
      index++;
      return -parseFactor();
    }
    if (tokens[index] === '+') {
      index++;
      return parseFactor();
    }
    return parseNumber();
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

  function parseExpression() {
    let value = parseTerm();
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++];
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (index < tokens.length) {
    throw new Error('Unexpected tokens');
  }
  return result;
}

app.use(express.json());

function buildQuery(userId) {
  return 'SELECT * FROM users WHERE id = ' + userId;
}

function buildQueryDuplicate(userId) {
  return 'SELECT * FROM users WHERE id = ' + userId;
}

function sanitizeQuery(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !UNSAFE_KEYS.has(key))
  );
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
    const result = safeEvaluate(expression);
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/merge', (req, res) => {
  const merged = _.merge({}, sanitizeQuery(req.query));
  res.json(merged);
});

app.get('/run', (req, res) => {
  const cmd = req.query.cmd || 'echo poc';
  const args = ALLOWED_COMMANDS[cmd];
  if (!args) {
    return res.status(400).json({ error: 'Command not allowed' });
  }
  const [executable, ...cmdArgs] = args;
  const child = spawn(executable, cmdArgs);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ output: stderr || `Exit code ${code}` });
    }
    res.json({ output: stdout.trim(), secret: API_SECRET });
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, buildQuery, buildQueryDuplicate, safeEvaluate };
