const AbortController = require('abort-controller');
const fetch = require('node-fetch');

function log(message) {
  if (typeof message === 'object') {
    message = JSON.stringify(message);
  } else if (message.toString) {
    message = message.toString();
  }

  // setImmediate(() => fs.writeSync(process.stdout.fd, message + '\n'));
  setImmediate(() => process.stdout.write(message + '\n'));
}

function fetchTimeout(url, ms, { signal, ...options } = {}) {
  const controller = new AbortController();
  const promise = fetch(url, { signal: controller.signal, ...options });
  if (signal) signal.addEventListener('abort', () => controller.abort());
  const timeout = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timeout));
}

function delay(t, v) {
  return new Promise(function (resolve) {
    setTimeout(resolve.bind(null, v), t);
  });
}

function freeRegExp() {
  /\s*/g.exec('');
}

module.exports = { log, fetchTimeout, delay, freeRegExp };
