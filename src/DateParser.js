import { ApiError, getId, getError, ensureCacheSize } from './util.js';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import cache from 'memory-cache';
import moment from 'moment';
import _ from 'lodash';

const cacheDuration = 1000 * 60 * 10; // 10 minutes
const maxCacheItems = 1000;

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

let queueEvents = null;
let workerQueue = null;

export class DateParser {
  static instance = new DateParser();
  static jobs = {};

  constructor(opts = {}) {
    _.defaults(opts, {
      enablePuppeteer: true,
      puppeteerDelay: 3000,
      puppeteerCloseDelay: 10000,
      disableCache: false,
      method: null,
      findMetadata: false,
      timeout: 30000,
      priority: undefined
    });

    this.opts = opts;
    this.connect();
  }

  async connect() {
    if (!queueEvents) {
      queueEvents = new QueueEvents('date-worker', { connection });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        console.error('QUEUE FAILED', jobId, failedReason);
      });

      queueEvents.on('error', error => {
        console.error('QUEUE ERROR', error);
      });

      queueEvents.on('stalled', async ({ jobId }) => {
        console.error('QUEUE STALLED', jobId);
      });
    }

    if (!workerQueue) {
      workerQueue = new Queue('date-worker', {
        connection,
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 10,
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        }
      });
    }
  }

  async get(url, opts = {}) {
    if (url && url.trim().match(/\.pdf($|\?)/)) {
      return Promise.reject('URL refers to a PDF');
    }

    const checkModified = _.isBoolean(opts)
      ? opts
      : opts.checkModified ?? false;

    const args = { url, checkModified, ...this.opts };

    if (_.isPlainObject(opts)) {
      Object.assign(args, opts);
    }

    if (!args.disableCache) {
      const cachedValue = cache.get(url);

      ensureCacheSize(cache, maxCacheItems);

      if (cachedValue) {
        return cachedValue instanceof ApiError
          ? Promise.reject(cachedValue)
          : Promise.resolve(cachedValue);
      }
    }

    const jobId = getJobId(url);

    try {
      const job = await workerQueue.add(
        'get-date',
        { ...args, jobId },
        { priority: args.priority }
      );

      const data = await job.waitUntilFinished(queueEvents, args.timeout);

      const { type, result } = data;
      const isSuccess = type === 'success' && result;

      if (isSuccess) {
        const { publishDate, modifyDate } = result;
        result.publishDate = publishDate ? moment(publishDate) : null;
        result.modifyDate = modifyDate ? moment(modifyDate) : null;
      }

      if (!opts.disableCache) {
        cache.put(url, result, cacheDuration);
      }

      return result;
    } catch (error) {
      return getError(error, url);
    }
  }

  async close({ puppeteerCloseDelay, clearCache } = {}) {
    if (clearCache) this.clearCache();
    await workerQueue.add('close', { puppeteerCloseDelay, clearCache });
  }

  clearCache() {
    if (!this.opts.disableCache) cache.clear();
  }
}

function getJobId(url) {
  return getId(url, _.uniqueId('job'));
}

export default DateParser.instance;
