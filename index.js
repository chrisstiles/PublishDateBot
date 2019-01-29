const express = require('express');
const app = express();
const path = require('path');

// Serve static landing page for Chrome extension
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT);