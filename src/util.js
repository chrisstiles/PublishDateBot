import AbortController from 'abort-controller';
import fetch from 'node-fetch';
import { createRequire } from 'module';

const get = createRequire(import.meta.url);

export function log(message) {
  if (typeof message === 'object') {
    message = JSON.stringify(message);
  } else if (message.toString) {
    message = message.toString();
  }

  setImmediate(() => process.stdout.write(message + '\n'));
}

export function fetchTimeout(url, ms, { signal, ...options } = {}) {
  const controller = new AbortController();
  const promise = fetch(url, { signal: controller.signal, ...options });
  if (signal) signal.addEventListener('abort', () => controller.abort());
  const timeout = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timeout));
}

export function delay(t, v) {
  return new Promise(function (resolve) {
    setTimeout(resolve.bind(null, v), t);
  });
}

export function freeRegExp() {
  /\s*/g.exec('');
}

export const config = get('../bot.config.json');

export function getConfig() {
  return get('../bot.config.json');
}
