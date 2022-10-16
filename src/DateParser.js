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
const fetchMethods = {
  FETCH: 'fetch',
  PUPPETEER: 'puppeteer'
};

export default class DateParser {
  constructor(opts = {}) {
    _.defaults(opts, {
      enablePuppeteer: true,
      puppeteerDelay: 3000,
      disableCache: false,
      method: null
    });

    this.browser = null;
    this.enablePuppeteer = opts.enablePuppeteer;
    this.puppeteerDelay = opts.puppeteerDelay;
    this.disableCache = opts.disableCache;
    this.method = opts.method;
  }

  async launch() {
    if (this.enablePuppeteer && !this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox']
      });
    }

    return this;
  }

  async get(url, checkModified) {
    if (url && url.trim().match(/\.pdf($|\?)/)) {
      return Promise.reject('URL refers to a PDF');
    }

    if (!this.disableCache) {
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
    }

    try {
      const html = await this.loadPage(url);
      const data = await getPublishDate(url, checkModified, html);

      if (!this.disableCache) {
        cache.put(url, data, cacheDuration);
      }

      return data;
    } catch (error) {
      const apiError = getError(error, url);

      if (!this.disableCache) {
        cache.put(url, apiError, cacheDuration);
      }

      return Promise.reject(apiError);
    }
  }

  get forcePuppeteer() {
    return this.enablePuppeteer && this.method === fetchMethods.PUPPETEER;
  }

  get forceFetch() {
    return this.method === fetchMethods.FETCH;
  }

  // It is usually faster to get an article's HTML using
  // fetch, so we try that first. If the request fails or
  // is taking too long we attempt loading it with puppeteer.
  async loadPage(url) {
    // We cache whichever method is successful
    // and use it for subsequent requests
    const cacheKey = `fetchMethod-${new URL(url).hostname}`;

    if (!this.disableCache || this.forcePuppeteer || this.forceFetch) {
      const fetchMethod = cache.get(cacheKey);
      const isPuppeteer = fetchMethod === fetchMethods.PUPPETEER;
      const isFetch = fetchMethod === fetchMethods.FETCH;

      if (
        this.forcePuppeteer ||
        (this.enablePuppeteer && isPuppeteer && !isFetch)
      ) {
        return this.getPageWithPuppeteer(url);
      }

      if (this.forceFetch || isFetch) {
        return fetchArticle(url, true);
      }
    }

    const controller = new AbortController();
    let puppeteerTimeout = null;

    const getWithPuppeteer = async () => {
      return new Promise((resolve, reject) => {
        puppeteerTimeout = setTimeout(async () => {
          try {
            const html = await this.getPageWithPuppeteer(url);
            controller.abort();

            if (!this.disableCache) {
              cache.put(cacheKey, 'puppeteer', cacheDuration);
            }

            resolve(html);
          } catch (error) {
            reject(error);
          }
        }, this.puppeteerDelay);
      });
    };

    const getWithFetch = async () => {
      console.log('Starting fetch', url);
      const html = await fetchArticle(url, true, controller);
      clearTimeout(puppeteerTimeout);

      if (!this.disableCache) {
        cache.put(cacheKey, 'fetch', cacheDuration);
      }

      return html;
    };

    try {
      const promises = [getWithFetch()];
      if (this.enablePuppeteer) promises.push(getWithPuppeteer());
      return await Promise.any(promises);
    } catch {
      return Promise.reject('Error loading page');
    }
  }

  async getPageWithPuppeteer(url) {
    if (!this.enablePuppeteer) {
      return Promise.reject('Puppeteer is disabled');
    }

    console.log('Starting puppeteer', url);
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
    if (!this.disableCache) cache.clear();
  }
}
