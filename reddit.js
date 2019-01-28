///////////////////////
// Initialize 
///////////////////////

const getPublishDate = require('./get-publish-date');

// Environment Variables
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const refreshToken = process.env.REDDIT_REFRESH_TOKEN;
const databaseURL = process.env.DATABASE_URL;


///////////////////////
// Database 
///////////////////////

const { Client } = require('pg');
const client = new Client({
  connectionString: databaseURL,
  ssl: true,
});

function filterPreviouslyCommentedPosts(ids) {
  return new Promise((resolve, reject) => {
    if (!ids || !ids.length) {
      reject('No post ids');
    }

    client.connect();

    if (typeof ids === 'string') {
      ids = [ids];
    }

    const params = [];
    for (let i = 1; i <= ids.length; i++) {
      params.push(`($${i})`);
    }

    const queryString = `
      SELECT post_id
      FROM (VALUES ${params.join(',')}) V(post_id)
      EXCEPT
      SELECT post_id 
      FROM comments;
    `;

    const query = {
      text: queryString,
      values: ids,
      rowMode: 'array'
    }

    client.query(query)
      .then(res => {
        client.end();

        const rows = res.rows.map(row => {
          return row[0];
        });

        resolve(rows);
      })
      .catch(error => {
        client.end();
        reject(error.stack);
      });
  });
}

function recordCommentedPost(id) {
  client.connect();

  const queryString = 'INSERT into comments(post_id) values($1)';

  client.query(queryString, [id])
    .then(res => client.end())
    .catch(error => {
      client.end();
      console.error(error.stack);
    });
}


///////////////////////
// Reddit 
///////////////////////

// Set up Reddit client
const snoowrap = require('snoowrap');
const reddit = new snoowrap({
  userAgent: 'Article publish date bot (by /u/PublishDateBot)',
  clientId,
  clientSecret,
  refreshToken
});

const subredditName = 'chriscss';
// TODO: Check article date based on when post was submitted

function getSubmissions(name) {
  const subreddit = reddit.getSubreddit(name);

  return new Promise((resolve, reject) => {
    subreddit
      .getHot({
        limit: 50
      })
      .then(hotListing => {
        subreddit
          .getRising()
          .then(risingListing => {
            const submissions = mergeListings(hotListing, risingListing);
            resolve(submissions);
          });
      });
  });
}

function checkSubreddit(name) {
  getSubmissions(name)
    .then(submissions => {
      for (let submission of submissions) {
        // submission.reply('Test comment please ignore');
        getPublishDate(submission.url)
          .then(date => {
            
            // reddit.getSubmission()

          })
          .catch(error => {
            console.log(error);
          });

      }
    });
}

function mergeListings(listing1, listing2) {
  const ids = [];
  const submissions = listing1.map(submission => {
    ids.push(submission.id);
    return submission;
  });
  
  for (let submission of listing2) {
    if (!ids.includes(submission.id)) {
      submissions.push(submission);
    }
  }

  return submissions;
}

module.exports = { checkSubreddit, recordCommentedPost, filterPreviouslyCommentedPosts };

// module.exports = title => {
  // reddit.getSubreddit('chriscss').submitLink({
  //   title,
  //   url: 'https://www.christopherstiles.com'
  // });
// }