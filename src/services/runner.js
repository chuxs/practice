const vm = require('vm');
const path = require('path');
const util = require('util');
const url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');
const events = require('events');
const stream = require('stream');
const { StringDecoder } = require('string_decoder');
const Buffer = require('buffer').Buffer;

const ALLOWED_MODULES = {
  path,
  util,
  url,
  querystring,
  crypto,
  events,
  stream,
  string_decoder: { StringDecoder },
  buffer: { Buffer },
};

function formatValue(value) {
  if (typeof value === 'string') return value;
  try {
    return util.inspect(value, { depth: 4, colors: false, breakLength: 80 });
  } catch {
    return String(value);
  }
}

function createConsole(logs) {
  const write = (level) => (...args) => {
    logs.push({
      level,
      text: args.map(formatValue).join(' '),
    });
  };
  return {
    log: write('log'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    debug: write('debug'),
  };
}

function runJavaScript(code, { allowRequire = false } = {}) {
  const logs = [];
  const sandbox = {
    console: createConsole(logs),
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  if (allowRequire) {
    sandbox.require = (name) => {
      if (!Object.prototype.hasOwnProperty.call(ALLOWED_MODULES, name)) {
        throw new Error(
          `require('${name}') is not allowed in the sandbox. Allowed: ${Object.keys(ALLOWED_MODULES).join(', ')}`
        );
      }
      return ALLOWED_MODULES[name];
    };
    sandbox.module = { exports: {} };
    sandbox.exports = sandbox.module.exports;
    sandbox.__dirname = path.join(process.cwd(), 'sandbox');
    sandbox.__filename = path.join(sandbox.__dirname, 'solution.js');
    sandbox.process = {
      env: {},
      cwd: () => sandbox.__dirname,
      nextTick: (fn) => process.nextTick(fn),
    };
  }

  try {
    const script = new vm.Script(code, { filename: 'solution.js' });
    const context = vm.createContext(sandbox);
    const result = script.runInContext(context, { timeout: 3000 });

    const lines = logs.map((entry) => entry.text);
    if (result !== undefined) {
      lines.push(`← ${formatValue(result)}`);
    }

    return {
      ok: true,
      output: lines.length ? lines.join('\n') : '(no output — use console.log to print values)',
    };
  } catch (err) {
    const lines = logs.map((entry) => entry.text);
    lines.push(`Error: ${err.message}`);
    return {
      ok: false,
      output: lines.join('\n'),
    };
  }
}

async function runSql(code) {
  let alasql;
  try {
    alasql = require('alasql');
  } catch {
    return {
      ok: false,
      output:
        'SQL runner is not installed. Run `npm install alasql` and restart the server.',
    };
  }

  try {
    // Fresh in-memory database per run
    alasql('DROP DATABASE IF EXISTS practice');
    alasql('CREATE DATABASE practice');
    alasql('USE practice');

    const statements = String(code || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    if (statements.length === 0) {
      return { ok: false, output: 'No SQL to run.' };
    }

    const chunks = [];
    for (const statement of statements) {
      const result = alasql(statement);
      if (Array.isArray(result)) {
        chunks.push(formatValue(result));
      } else if (result !== undefined) {
        chunks.push(formatValue(result));
      }
    }

    return {
      ok: true,
      output: chunks.length ? chunks.join('\n\n') : '(query finished with no result set)',
    };
  } catch (err) {
    return {
      ok: false,
      output: `Error: ${err.message}`,
    };
  }
}

async function runCode(topic, code) {
  const source = String(code || '').trim();
  if (!source) {
    return { ok: false, output: 'Editor is empty.' };
  }

  if (topic === 'sql') {
    return runSql(source);
  }

  return runJavaScript(source, { allowRequire: topic === 'nodejs' });
}

module.exports = {
  runCode,
};
