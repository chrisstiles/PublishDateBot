import AbortController from 'abort-controller';
import fetch from 'node-fetch';
import { createRequire } from 'module';

const get = createRequire(import.meta.url);

export function log(message) {
  if (message instanceof ApiError) {
    message = message.error;
  } else if (typeof message === 'object') {
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

// JSDOM does not include HTMLElement.innerText
export function innerText(el) {
  el = el.cloneNode(true);
  el.querySelectorAll('script, style').forEach(s => s.remove());

  return el.textContent
    .replace(/\n\s*\n/g, '\n')
    .replace(/  +/g, '')
    .trim();
}

export class ApiError {
  constructor(url, message, type = 'server') {
    this.url = url;
    this.message = message || 'API error';
    this.type = type;
  }
}

export class DateNotFoundError extends ApiError {
  constructor(url) {
    super(url, 'No date found', 'not-found');
  }
}

export function getError(error, url) {
  if (error instanceof ApiError) return error;

  const maxErrorLength = 500;
  const message =
    (typeof error === 'string' ? error : error.message)?.trim() || 'API error';

  return new ApiError(url, message.substring(0, maxErrorLength));
}
