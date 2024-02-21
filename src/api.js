import data from './data/index.js';
import parser from './DateParser.js';
import { ApiError, isMediaLink } from './util.js';
import express from 'express';
import cors from 'cors';
import _ from 'lodash';
import prettier from 'prettier';

const router = express.Router();

router.get('/ping', cors(), (_, res) => res.sendStatus(200));

router.get('/get-date', cors(), async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  let url = null;

  try {
    url = new URL(req.query.url);
  } catch {
    return res.send({
      error: 'Please enter a valid URL',
      errorType: 'validation'
    });
  }

  if (isMediaLink(url)) {
    const isPDF = url.pathname.endsWith('.pdf');
    const text = isPDF ? 'PDFs' : 'media links';

    return res.send({
      error: `Parsing publish dates from ${text} is not supported`,
      errorType: 'validation'
    });
  }

  const response = {
    organization: null,
    title: null,
    description: null,
    publishDate: null,
    modifyDate: null,
    location: null,
    html: null,
    error: null,
    errorType: null
  };

  const { cache, method } = req.query;

  try {
    const args = {
      checkModified: true,
      disableCache: cache === 'false',
      method: method || null,
      findMetadata: true,
      puppeteerDelay: 200,
      puppeteerCloseDelay: 15000,
      timeout: 15000
    };

    const data = (await parser.get(url.href, args)) ?? {};

    // Format outputted HTML
    if (data.html) {
      data.html = prettier.format(data.html, {
        parser: 'html',
        printWidth: 52,
        htmlWhitespaceSensitivity: 'ignore'
      });
    }

    res.json(
      Object.assign(response, {
        ...data,
        publishDate: data.publishDate?.toISOString() ?? null,
        modifyDate: data.modifyDate?.toISOString() ?? null
      })
    );
  } catch (error) {
    console.error(error);

    const data = Object.assign(response, {
      error: 'Publish date not found',
      errorType: error instanceof ApiError ? error.type : 'server'
    });

    if (error instanceof ApiError && _.isPlainObject(error.metadata)) {
      Object.assign(data, error.metadata);
    }

    res.json(data);
  }
});

// Returns up-to-date configuration data to Chrome extension,
// removing configurations that are only used on the backend
const configData = _.cloneDeep(data);

if (configData.sites) {
  Object.keys(configData.sites).forEach(key => {
    delete configData.sites[key].metadata;

    if (!Object.keys(configData.sites[key]).length) {
      delete configData.sites[key];
    }
  });
}

router.get('/data', cors(), (_, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.json(configData);
});

export default router;
