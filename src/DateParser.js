import { getPublishDate, fetchArticle } from './get-publish-date.js';
import { ApiError, getError } from './util.js';
import cache from 'memory-cache';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import _ from 'lodash';

puppeteer.use(StealthPlugin());
puppeteer.use(
  AdblockerPlugin({
    blockTrackers: true,
    blockTrackersAndAnnoyances: true,
    interceptResolutionPriority: 0
  })
);

const cacheDuration = 1000 * 60 * 10; // 10 minutes
const maxCacheItems = 1000;

export default class DateParser {
  constructor(opts = {}) {
    _.defaults(opts, {
      usePuppeteer: true,
      puppeteerDelay: 3000
    });

    this.browser = null;
    this.usePuppeteer = opts.usePuppeteer;
    this.puppeteerDelay = opts.puppeteerDelay;
  }

  async launch() {
    if (this.usePuppeteer && !this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      return cachedValue instanceof ApiError
        ? Promise.reject(cachedValue)
        : Promise.resolve(cachedValue);
    }

    try {
      const html = await this.loadPage(url);
      const data = await getPublishDate(url, checkModified, html);
      cache.put(url, data, cacheDuration);
      return data;
    } catch (error) {
      const apiError = getError(error, url);
      cache.put(url, apiError, cacheDuration);
      return Promise.reject(apiError);
    }
  }

  // It is usually faster to get an article's HTML using
  // fetch, so we try that first. If the request fails or
  // is taking too long we attempt loading it with puppeteer.
  async loadPage(url) {
    // We cache whichever method is successful
    // and use it for subsequent requests
    const cacheKey = `fetchMethod:${new URL(url).hostname}`;
    let fetchMethod = cache.get(cacheKey);

    if (this.usePuppeteer && fetchMethod === 'puppeteer') {
      return this.getPageWithPuppeteer(url);
    } else if (fetchMethod === 'fetch') {
      return fetchArticle(url, true);
    }

    const controller = new AbortController();
    let puppeteerTimeout = null;

    const getWithPuppeteer = async () => {
      return new Promise((resolve, reject) => {
        puppeteerTimeout = setTimeout(async () => {
          try {
            const html = await this.getPageWithPuppeteer(url);
            controller.abort();
            cache.put(cacheKey, 'puppeteer', cacheDuration);
            resolve(html);
          } catch (error) {
            reject(error);
          }
        }, this.puppeteerDelay);
      });
    };

    const getWithFetch = async () => {
      const html = await fetchArticle(url, true, controller);
      clearTimeout(puppeteerTimeout);
      cache.put(cacheKey, 'puppeteer', cacheDuration);
      return html;
    };

    try {
      const promises = [getWithFetch()];
      if (this.usePuppeteer) promises.push(getWithPuppeteer());
      return await Promise.any(promises);
    } catch {
      return Promise.reject('Error loading page');
    }
  }

  async getPageWithPuppeteer(url) {
    if (!this.usePuppeteer) {
      return Promise.reject('Puppeteer is disabled');
    }

    console.log('Using puppeteer', url);
    await this.launch();
    const page = await this.browser.newPage();

    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);

    page.on('request', request => {
      if (request.resourceType() === 'document') {
        request.continue();
      } else {
        request.abort();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const html = await page.content();
    if (!page.isClosed()) await page.close();

    return html || Promise.reject('Error loading page');
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
