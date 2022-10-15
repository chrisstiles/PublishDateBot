import data from './data/index.js';
import getPublishDate from './get-publish-date.js';
import { ApiError, DateNotFoundError } from './util.js';
import express from 'express';
import cors from 'cors';
import _ from 'lodash';

const router = express.Router();

router.get('/data', cors(), (_, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(data);
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

  if (url.pathname.endsWith('.pdf')) {
    return res.send({
      error: 'Parsing publish dates from PDFs is not supported',
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

  try {
    const data = (await getPublishDate(url.href, true)) ?? {};

    if (
      data.publishDate &&
      data.modifyDate &&
      !data.modifyDate.isAfter(data.publishDate, 'd')
    ) {
      data.modifyDate = null;
    }

    return res.json(
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

    if (error instanceof DateNotFoundError && _.isPlainObject(error.metadata)) {
      Object.assign(data, error.metadata);
    }

    return res.json(data);
  }
});

export default router;
