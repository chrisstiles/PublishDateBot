const fs = require('fs');
const AbortController = require('abort-controller');
const fetch = require('node-fetch');

function log(message) {
  if (typeof message === 'object') {
    message = JSON.stringify(message);
  } else if (message.toString) {
    message = message.toString();
  }

  setImmediate(() => fs.writeSync(process.stdout.fd, message + '\n'));
}

function fetchTimeout(url, ms, { signal, ...options } = {}) {
  const controller = new AbortController();
  const promise = fetch(url, { signal: controller.signal, ...options });
  if (signal) signal.addEventListener('abort', () => controller.abort());
  const timeout = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timeout));
}

module.exports = { log, fetchTimeout };
