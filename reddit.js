
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const snoowrap = require('snoowrap');
const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const refreshToken = process.env.REDDIT_REFRESH_TOKEN;

const reddit = new snoowrap({
  userAgent: 'Article publish date bot (by /u/PublishDateBot',
  clientId,
  clientSecret,
  refreshToken
});

module.exports = title => {
  reddit.getSubreddit('chriscss').submitLink({
    title,
    url: 'https://www.christopherstiles.com'
  });
}