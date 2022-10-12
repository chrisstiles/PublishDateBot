import express from 'express';
import cors from 'cors';
import data from './data/index.js';
import getPublishDate from './get-publish-date.js';

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

  try {
    const data = await getPublishDate(url.href);
    const { publishDate, title, description, location, html } = data;
    const date = publishDate?.toISOString() ?? null;

    res.send({
      title,
      description,
      date,
      location,
      html
    });
  } catch (error) {
    console.error('API error:', error);

    return res.send({
      error: 'Publish date not found',
      errorType: 'server'
    });
  }
});

export default router;
