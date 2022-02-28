import express from 'express';
import compression from 'compression';
import cors from 'cors';
import favicon from 'serve-favicon';
import data from './data/index.js';

const app = express();

app.use(compression());
app.use(favicon('src/public/images/favicon.png'));
app.use(express.static('src/public'));

app.disable('x-powered-by');

app.get('/api/data', cors(), (_, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(data);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT);
