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

export const fetchMethods = {
  FETCH: 'fetch',
  PUPPETEER: 'puppeteer'
};

export class ApiError {
  constructor(url, message, type = 'server') {
    this.url = url;
    this.message = message || `API error: ${url}`;
    this.type = type;
    this.errorType = 'ApiError';
  }

  get name() {
    return this.constructor.name;
  }
}

export class DateNotFoundError extends ApiError {
  constructor(url, metadata) {
    super(url, `No date found: ${url}`, 'date-not-found');

    this.errorType = 'DateNotFoundError';

    if (_.isPlainObject(metadata)) {
      this.metadata = metadata;
    }
  }

  get name() {
    return 'UnrecoverableError';
  }
}

export class ArticleFetchError extends ApiError {
  constructor(url, metadata) {
    super(url, `Page not found: ${url}`, 'loading-failed');

    this.errorType = 'ArticleFetchError';

    if (_.isPlainObject(metadata)) {
      this.metadata = metadata;
    }
  }
}

export function getError(error, url) {
  if (_.isPlainObject(error) && error.errorType) {
    switch (error.errorType) {
      case 'ArticleFetchError':
        return new ArticleFetchError(url, error.metadata);
      case 'DateNotFoundError':
        return new DateNotFoundError(url, error.metadata);
      default:
        return new ApiError(url, error.message);
    }
  }

  if (error.name === 'AggregateError') {
    error = error.errors.find(e => e instanceof ApiError) ?? error;
  }

  if (error instanceof ApiError) return error;

  if (error.message?.match(/timed? ?out/i)) {
    return new ArticleFetchError(url);
  }

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
  if (el.dataset && el.getAttributeNames().length > 1) {
    for (const prop in el.dataset) {
      if (!prop.match(/date|time|publish/i)) {
        delete el.dataset[prop];
      }
    }
  }
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
  if (typeof str !== 'string' || !str.trim()) return null;
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

// prettier-ignore
const mediaExtensions = ['pdf','doc','docx','ppt','pptx','xls','xlsx','xml','bmp','gif','jpg','jpeg','png','wav','mp3','mp4','mpg','mpeg','mov','avi','rar','zip','txt','rtf','webm','ogg','wav','ogv','oga','flv','m4v','svg','css','js','json','lottie','woff','woff2','otf'];

export function isMediaLink(url) {
  if (!url) return false;
  if (typeof url === 'string') {
    try {
      url = new URL(url.trim());
    } catch {
      return false;
    }
  }

  return mediaExtensions.includes(url.pathname.split('.').pop());
}

// Original hash function from https://stackoverflow.com/a/52171480
export function getId(str, prefix, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const id = String(4294967296 * (2097151 & h2) + (h1 >>> 0));

  return prefix ? `${prefix}-${id}` : id;
}

export async function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function ensureCacheSize(cache, maxCacheItems) {
  if (cache.size() >= maxCacheItems) {
    cache
      .keys()
      .slice(0, Math.floor(maxCacheItems / 2))
      .forEach(key => {
        cache.del(key);
      });
  }
}
