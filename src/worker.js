import {
  getPublishDate,
  fetchArticle,
  getArticleMetadata
} from './get-publish-date.js';
import {
  ArticleFetchError,
  getError,
  getSiteMetadata,
  ensureCacheSize,
  fetchMethods,
  DateNotFoundError
} from './util.js';
import { cacheDuration, maxCacheItems, maxRetries } from './DateParser.js';
import { Worker } from 'bullmq';
import connection from './redis.js';
import throng from 'throng';
import basePuppeteer from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import cache from 'memory-cache';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const puppeteer = addExtra(basePuppeteer);

puppeteer.use(StealthPlugin());
puppeteer.use(
  AdblockerPlugin({
    blockTrackers: true,
    blockTrackersAndAnnoyances: true,
    interceptResolutionPriority: 0
  })
);

async function start() {
  const { getCluster, closeCluster, clearCloseClusterTimer } = (() => {
    let cluster = null;
    let closeClusterTimer = null;
    let isClosing = false;
    let promises = [];

    return {
      getCluster: async (shouldLaunch = true) => {
        if (isClosing && !cluster?.isClosed) {
          await cluster?.close();
          cluster = null;
        }

        if (shouldLaunch) {
          clearTimeout(closeClusterTimer);

          if (!cluster || cluster.isClosed) {
            cluster = await Cluster.launch({
              puppeteer,
              maxConcurrency: 2,
              concurrency: Cluster.CONCURRENCY_CONTEXT,
              puppeteerOptions: {
                headless: true,
                args: [
                  '--disable-accelerated-2d-canvas',
                  '--disable-dev-shm-usage',
                  '--disable-gpu',
                  '--disable-setuid-sandbox',
                  '--ignore-certificate-errors',
                  '--no-sandbox'
                ]
              }
            });
          }
        }

        return cluster;
      },
      clearCloseClusterTimer: () => clearTimeout(closeClusterTimer),
      closeCluster: async (delay = 10000) => {
        clearTimeout(closeClusterTimer);

        if (!cluster) {
          promises.forEach(resolve => resolve());
          promises = [];
          return Promise.resolve();
        }

        closeClusterTimer = setTimeout(async () => {
          if (!cluster) return;
          isClosing = true;

          if (!cluster?.isClosed) {
            await cluster?.idle();
            await cluster?.close();
          }

          isClosing = false;
          cluster = null;
          promises.forEach(resolve => resolve());
          promises = [];
        }, delay);

        return new Promise(resolve => {
          promises.push(resolve);
        });
      }
    };
  })();

  async function execute(job) {
    const {
      url,
      jobId,
      checkModified,
      enablePuppeteer,
      disableCache,
      puppeteerDelay,
      puppeteerCloseDelay,
      method,
      findMetadata,
      timeout
    } = job.data;

    clearCloseClusterTimer();
    if (!disableCache) ensureCacheSize(cache, maxCacheItems);

    const getPageWithPuppeteer = async () => {
      if (!enablePuppeteer) {
        return Promise.reject('Puppeteer is disabled');
      }

      const cluster = await getCluster(true);

      return await cluster.execute(url, async ({ page }) => {
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);

        if (process.env.SCRAPER_USER_AGENT) {
          await page.setUserAgent(process.env.SCRAPER_USER_AGENT);
        }

        page.on('request', request => {
          if (request.resourceType() === 'document') {
            request.continue();
          } else {
            request.abort();
          }
        });

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeout
        });

        const html = await page.content();

        if (!response.ok()) {
          if (response.status() === 404) {
            throw new ArticleFetchError(
              url,
              getArticleMetadata(html, url, true)
            );
          }

          return Promise.reject('Error loading page');
        }

        return html || Promise.reject('Error loading page');
      });
    };

    const loadPage = async url => {
      // We cache whichever method is successful
      // and use it for subsequent requests
      const cacheKey = `fetchMethod-${new URL(url).hostname}`;
      const { fetchWith } = getSiteMetadata(url);

      const usePuppeteer = method === fetchMethods.PUPPETEER;
      const useFetch = method === fetchMethods.FETCH;

      const forcePuppeteer =
        enablePuppeteer &&
        !useFetch &&
        (usePuppeteer || fetchWith === fetchMethods.PUPPETEER);

      const forceFetch = useFetch || fetchWith === fetchMethods.FETCH;

      if (!disableCache || forcePuppeteer || forceFetch) {
        const cachedMethod = cache.get(cacheKey);
        const isPuppeteer = cachedMethod === fetchMethods.PUPPETEER;
        const isFetch = cachedMethod === fetchMethods.FETCH;

        if (forcePuppeteer || (enablePuppeteer && isPuppeteer && !isFetch)) {
          if (!cachedMethod) console.log('Force puppeteer', url);
          return getPageWithPuppeteer(url);
        }

        if (forceFetch || isFetch) {
          if (!cachedMethod) console.log('Force fetch', url);
          return fetchArticle(url, true);
        }
      }

      const controller = new AbortController();

      let puppeteerTimeout = null;

      const getWithPuppeteer = async () => {
        return new Promise((resolve, reject) => {
          puppeteerTimeout = setTimeout(async () => {
            try {
              const html = await getPageWithPuppeteer(url);
              controller.abort();

              if (!disableCache) {
                cache.put(cacheKey, 'puppeteer', cacheDuration);
              }

              resolve(html);
            } catch (error) {
              reject(error);
            }
          }, puppeteerDelay);
        });
      };

      const getWithFetch = async () => {
        const html = await fetchArticle(url, true, controller, timeout);
        clearTimeout(puppeteerTimeout);

        if (!disableCache) {
          cache.put(cacheKey, 'fetch', cacheDuration);
        }

        return html;
      };

      try {
        const promises = [getWithFetch()];
        if (enablePuppeteer) promises.push(getWithPuppeteer());
        return await Promise.any(promises);
      } catch (error) {
        return Promise.reject(error);
      }
    };

    const sharedResultArgs = { url, disableCache, id: jobId };
    const closeDelay = Math.max(100, puppeteerCloseDelay ?? 100);

    try {
      const html = await loadPage(url);
      const data = await getPublishDate(url, checkModified, html, findMetadata);

      setTimeout(() => {
        closeCluster(closeDelay - 100);
      }, 100);

      return {
        type: 'success',
        result: data,
        ...sharedResultArgs
      };
    } catch (e) {
      setTimeout(() => {
        closeCluster(closeDelay - 100);
      }, 100);

      const error = getError(e, url);

      if (
        job.attemptsMade < maxRetries &&
        !(error instanceof DateNotFoundError)
      ) {
        throw error;
      }

      return {
        type: 'error',
        result: error,
        ...sharedResultArgs
      };
    }
  }

  const worker = new Worker(
    'date-worker',
    async job => {
      switch (job.name) {
        case 'get-date':
          return await execute(job);
        case 'close':
          if (job.data.clearCache) cache.clear();
          return closeCluster(job.data.puppeteerCloseDelay);
        default:
          return Promise.reject(new Error('Invalid job name'));
      }
    },
    { connection, concurrency: 7 }
  );

  worker.on('failed', ({ id, data }, error) => {
    if (!(error instanceof DateNotFoundError)) {
      console.error('WORKER FAILED', {
        id,
        url: data.url,
        error: getError(error)
      });
    }

    closeCluster();
  });

  worker.on('error', error => {
    console.error('WORKER ERROR', getError(error));
    closeCluster();
  });

  worker.on('stalled', jobId => {
    console.error('WORKER STALLED', jobId);
    closeCluster();
  });
}

throng({
  start,
  workers: process.env.WEB_CONCURRENCY || 2
});
