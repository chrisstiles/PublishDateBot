import { sites } from './data/index.js';
import AbortController from 'abort-controller';
import fetch from 'node-fetch';
import { createRequire } from 'module';
import _ from 'lodash';

const get = createRequire(import.meta.url);

export function log(error) {
  if (error instanceof ApiError) {
    error = error.message;
  } else if (typeof error === 'object') {
    error = JSON.stringify(error);
  } else if (error.toString) {
    error = error.toString();
  }

  setImmediate(() => process.stdout.write(error + '\n'));
}

export function fetchTimeout(url, ms, { signal, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  const promise = fetch(url, { signal: controller.signal, ...options });
  if (signal) {
    if (signal.aborted) controller.abort();

    signal.addEventListener('abort', () => {
      controller.abort();
      clearTimeout(timeout);
    });
  }
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
  if (!el) return '';

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
    this.message = message || `API error: ${url}`;
    this.type = type;
  }
}

export class DateNotFoundError extends ApiError {
  constructor(url, metadata) {
    super(url, `No date found: ${url}`, 'not-found');

    if (_.isPlainObject(metadata)) {
      this.metadata = metadata;
    }
  }
}

export function getError(error, url) {
  if (error instanceof ApiError) return error;

  const maxErrorLength = 800;
  const message =
    (typeof error === 'string' ? error : error.message)?.trim() || 'API error';

  return new ApiError(url, message.substring(0, maxErrorLength));
}

export function getSiteConfig(url) {
  const { hostname } = new URL(url);
  return sites[hostname.replace(/^www./, '')];
}

export function getSiteMetadata(url) {
  return getSiteConfig(url)?.metadata ?? {};
}

export function getElementHtml(el, isAttribute) {
  if (!el) return null;
  if (typeof el === 'string') return el.trim();
  if (isAttribute) return el.outerHTML;

  Array.from(el.children).forEach(child => {
    if (!innerText(child)) {
      el.removeChild(child);
    }
  });

  if (!el.children.length && el.outerHTML.length >= 52) {
    el.innerHTML = `\n${el.innerHTML}\n`;
  }

  return el.outerHTML;
}
