const express = require('express');
// const getPublishDate = require('./get-publish-date');
// const postToReddit = require('./reddit');
// const { recordCommentedPost, filterPreviouslyCommentedPosts } = require('./reddit');
const app = express();

// Route to get date based on URL parameter for testing
// app.get('/date', (req, res) => {
//   const { url } = req.query;

//   if (!url) {
//     res.send('<h1>No URL Passed</h1>');
//     return;
//   }

//   getPublishDate(url)
//     .then(date => {
//       const html = `<h1>Published: ${date}</h1><br>${url}`;
//       res.send(html);
//     })
//     .catch(error => {
//       res.send(`<h1 style="color:red">${error}</h1>`);
//     });
// });

// Route to test posting to reddit
// app.post('/reddit', (req, res) => {
//   const { title } = req.query;
//   if (!title) {
//     res.send('No title parameter');
//     return;
//   }

//   postToReddit(title);
//   res.send('Post submitted');
// });

// Route to test checking previously commented posts
// app.get('/comments', (req, res) => {
//   filterPreviouslyCommentedPosts(['123', '1234', 'abc', 'abcd', 'def', 'testing'])
//     .then(ids => {
//       res.send(`<h1>${ids.join(', ')}</h1>`);
//     })
//     .catch(error => {
//       res.send(`<h1 style="color: red">${error}</h1>`);
//     });
// });

// app.get('/authorize-callback', (req, res) => {
//   console.log(req);
//   res.send('<h1>Authorize Callback</h1>');
// });


// Serve static landing page for Chrome extension
app.get('/', (req, res) => {
  res.send('<h1>Static Landing Page</h1>');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT);

// const url = process.argv[2];
// getPublishDate(url);