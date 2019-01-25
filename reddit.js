
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const snoowrap = require('snoowrap');
const getPublishDate = require('./get-publish-date');
const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const refreshToken = process.env.REDDIT_REFRESH_TOKEN;

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
        submission.reply('Test comment please ignore');
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

checkSubreddit(subredditName);

function mergeListings(listing1, listing2) {
  const ids = [];
  const submissions = listing1.map(submission => {
    ids.push(submission.id);
    return submission;
  });
  
  for (let submission of listing2) {
    // const { id, url, media } = submission;

    if (!ids.includes(submission.id)) {
      submissions.push(submission);
    }
  }

  return submissions;
}

module.exports = checkSubreddit;

// module.exports = title => {
  // reddit.getSubreddit('chriscss').submitLink({
  //   title,
  //   url: 'https://www.christopherstiles.com'
  // });
// }