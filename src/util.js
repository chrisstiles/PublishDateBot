import { sites } from './data/index.js';
import AbortController from 'abort-controller';
import fetch from 'node-fetch';
import { createRequire } from 'module';
import _ from 'lodash';
import { decode } from 'html-entities';

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
    super(url, `No date found: ${url}`, 'date-not-found');

    if (_.isPlainObject(metadata)) {
      this.metadata = metadata;
    }
  }
}

export class ArticleFetchError extends ApiError {
  constructor(url) {
    super(url, `Page not found: ${url}`, 'loading-failed');
  }
}

export function getError(error, url) {
  if (error instanceof ApiError) return error;

  const maxErrorLength = 800;
  const message =
    (typeof error === 'string' ? error : error.message)?.trim() || 'API error';

  return ['AggregateError', 'FetchError', 'TimeoutError'].includes(error.name)
    ? new ArticleFetchError(url)
    : new ApiError(url, message.substring(0, maxErrorLength));
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

export function decodeHtml(str) {
  str = str?.trim();
  if (!str || typeof str !== 'string') return null;
  return decode(str.replace(/&lt;.+&gt;(.+)&lt;.+&gt;/g, '$1')).trim();
}

export function includesUrl(data, url) {
  if (!(url instanceof URL)) url = new URL(url);

  const dataset = new Set(data);
  const root = url.hostname.replace(/^www\./, '');

  return (
    dataset.has(root) ||
    (url.hostname.includes('www.') && dataset.has(url.hostname))
  );
}
