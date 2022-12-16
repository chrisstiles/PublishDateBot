import data from './data/index.js';
import DateParser from './DateParser.js';
import { ApiError, isMediaLink } from './util.js';
import express from 'express';
import cors from 'cors';
import _ from 'lodash';
import prettier from 'prettier';

const router = express.Router();

router.get('/data', cors(), (_, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(data);
});

router.get('/ping', cors(), (_, res) => res.sendStatus(200));

const parser = new DateParser({
  findMetadata: true,
  puppeteerDelay: 200,
  timeout: 15000
});

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

  parser.disableCache = cache === 'false';
  parser.method = method || null;
  // const parser = new DateParser({
  //   findMetadata: true,
  //   puppeteerDelay: 200,
  //   disableCache: cache === 'false',
  //   method: method || null,
  //   timeout: 15000
  // });

  try {
    const data = (await parser.get(url.href, true)) ?? {};

    if (
      data.publishDate &&
      data.modifyDate &&
      !data.modifyDate.isAfter(data.publishDate, 'd')
    ) {
      data.modifyDate = null;
    }

    parser.close();

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

    // parser.close();
  } catch (error) {
    console.error(error);

    const data = Object.assign(response, {
      error: 'Publish date not found',
      errorType: error instanceof ApiError ? error.type : 'server'
    });

    if (error instanceof ApiError && _.isPlainObject(error.metadata)) {
      Object.assign(data, error.metadata);
    }

    // await parser.close();

    // return res.json(data);
    res.json(data);

    // parser.close();
  } finally {
    parser.close();
  }
});

export default router;
