
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const snoowrap = require('snoowrap');
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

function checkSubreddit(name) {
  const subreddit = reddit.getSubreddit(name);

  subreddit
    .getHot({
      limit: 50
    })
    .then(hotListing => {
      subreddit
        .getRising()
        .then(risingListing => {

          const submissions = mergeListings(hotListing, risingListing);
          
        });
  });
}

checkSubreddit(subredditName);

function mergeListings(listing1, listing2) {
  const ids = [];
  const submissions = listing1.map(({ id, url, media }) => {
    ids.push(id);
    return { id, url, media };
  });
  
  for (let submission of listing2) {
    const { id, url, media } = submission;

    if (!ids.includes(id)) {
      submissions.push({ id, url, media });
    }
  }

  return submissions;
}

module.exports = title => {
  // reddit.getSubreddit('chriscss').submitLink({
  //   title,
  //   url: 'https://www.christopherstiles.com'
  // });
}