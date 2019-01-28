const express = require('express');
const app = express();

// Serve static landing page for Chrome extension
app.get('/', (req, res) => {
  res.send('<h1>Static Landing Page</h1>');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT);