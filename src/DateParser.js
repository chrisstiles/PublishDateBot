import cache from 'memory-cache';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import getPublishDate from './get-publish-date.js';
import { ApiError, getError } from './util.js';

puppeteer.use(StealthPlugin());
puppeteer.use(
  AdblockerPlugin({
    blockTrackers: true,
    interceptResolutionPriority: puppeteer.DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
  })
);

const cacheDuration = 1000 * 60 * 10; // 10 minutes
const maxCacheItems = 1000;

export default class DateParser {
  constructor() {
    this.browser = null;
  }

  async launch() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true
      });
    }

    return this;
  }

  async get(url, checkModified) {
    if (url && url.trim().match(/\.pdf($|\?)/)) {
      return Promise.reject('URL refers to a PDF');
    }

    const cachedValue = cache.get(url);

    if (cache.size() >= maxCacheItems) {
      cache
        .keys()
        .slice(0, Math.floor(maxCacheItems / 2))
        .forEach(key => {
          cache.del(key);
        });
    }

    if (cachedValue) {
      console.log('cached');
      return cachedValue instanceof ApiError
        ? Promise.reject(cachedValue)
        : Promise.resolve(cachedValue);
    }

    try {
      const html = await this.loadPage(url);
      return await getPublishDate(url, checkModified, html);
    } catch (error) {
      const apiError = getError(error, url);
      cache.put(url, apiError, cacheDuration);
      return Promise.reject(apiError);
    }
  }

  async loadPage(url) {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true
      });
    }

    const page = await this.browser.newPage();

    await page.setRequestInterception(true);

    page.on('request', request => {
      const blockedTypes = ['image', 'stylesheet', 'font', 'media'];

      if (blockedTypes.includes(request.resourceType())) {
        request._interceptionHandled = false;
        request.abort();
      } else if (request._interceptionHandled) {
        return;
      } else {
        request.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const html = await page.content();
    if (!page.isClosed()) await page.close();
    if (!html) return Promise.reject('Error loading page');

    return html;
  }

  async close(shouldClearCache) {
    if (shouldClearCache) this.clearCache();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  clearCache() {
    cache.clear();
  }
}
