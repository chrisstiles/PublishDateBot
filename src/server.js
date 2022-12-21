import 'newrelic';
import express from 'express';
import compression from 'compression';
import favicon from 'serve-favicon';
import apiRoutes from './api.js';

const app = express();

app.use(compression());
app.use(favicon('src/public/images/favicon.png'));
app.use(express.static('src/public'));
app.disable('x-powered-by');
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT);
