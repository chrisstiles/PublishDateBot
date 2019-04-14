///////////////////////
// Initialize 
///////////////////////

const config = require('./bot.config');
const getPublishDate = require('./get-publish-date');
const moment = require('moment');
const stripIndent = require('strip-indent');

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

client.connect();

function filterPreviouslyCommentedSubmissions(submissions) {
  return new Promise((resolve, reject) => {
    if (!submissions || !submissions.length) {
      reject('No submissions');
    }

    const ids = [];
    const params = [];
    for (let i = 0; i < submissions.length; i++) {
      ids.push(submissions[i].id);
      params.push(`($${i + 1})`);
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
        const uniqueIds = res.rows.map(row => {
          return row[0];
        });

        const uniqueSubmissions = [];
        submissions.forEach(submission => {
          if (uniqueIds.includes(submission.id)) {
            uniqueSubmissions.push(submission);
          }
        });
       
        resolve(uniqueSubmissions);
      })
      .catch(error => {
        reject(error.stack);
      });
  });
}

function recordCommentedSubmission(id) {
  return new Promise((resolve, reject) => {
    const queryString = 'INSERT into comments(post_id) values($1)';

    client.query(queryString, [id])
      .then(() => {
        console.log('Comment recorded')
        resolve();
      })
      .catch(error => {
        console.log(error.stack);
        resolve(error.stack)
      });
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
          })
          .catch(error => {
            console.error(error);
            resolve(null);
          });
      });
  });
}

// Checks if PublishDateBot is a mod of this subreddit
// and accepts an invitation to become a mod if it exists
function checkModStatus({ name, flair, flairId }) {
  return new Promise((resolve, reject) => {
    const subreddit = reddit.getSubreddit(name);

    subreddit
      .getModerators({ name: 'PublishDateBot' })
      .then(users => {
        let canModerate = !!users.length;
        
        if (canModerate && (flair || flairId)) {
          const permissions = users[0]['mod_permissions'];
          canModerate = permissions.includes('all') || permissions.includes('flair');
        }

        resolve(canModerate);
      })
      .catch(error => {
        console.log(error);
        resolve(false);
      })
  });
}

// Checks recent postings on a specific subreddit
// and comments if an out of date link is found
function checkSubreddit(data) {
  return new Promise((resolve, reject) => {
    checkModStatus(data)
      .then(canModerate => {
        data.canModerate = canModerate;
        getSubmissions(data.name)
          .then(mergedSubmissions => {
            if (!mergedSubmissions) {
              resolve();
              return;
            }

            filterPreviouslyCommentedSubmissions(mergedSubmissions)
              .then(submissions => {
                const promises = [];

                for (let submission of submissions) {
                  promises.push(checkSubmission(submission, data));
                }

                Promise.all(promises)
                  .then(() => {
                    resolve();
                  });
              })
              .catch(error => {
                console.error(error);
                resolve();
              });
          });
      });
  });
}

function checkSubmission(submission, data) {
  return new Promise((resolve, reject) => {
    const { url, created_utc: createdUTC } = submission;

    if (shouldCheckSubmission(submission)) {
      getPublishDate(url)
        .then(publishDate => {
          publishDate = moment(publishDate.format('YYYY-MM-DD'));
          const { time, units } = data;
          const postDate = moment(moment.utc(createdUTC, 'X').format('YYYY-MM-DD'));
          const outdatedDate = postDate.subtract(time, units);
          
          if (publishDate.isBefore(outdatedDate, 'd')) {
            submitComment(submission, publishDate, data)
              .then(() => {
                resolve();
              })
              .catch(error => {
                console.error(error);
                resolve();
              });
          } else {
            resolve();
          }

        })
        .catch(error => {
          // console.error(`${error}: ${url}`);
          resolve();
        })
    } else {
      resolve();
    }
  });
}

function submitComment(submission, date, data) {
  return new Promise((resolve, reject) => {
    const { text = '' } = data;
    const today = moment(moment().format('YYYY-MM-DD'));
    const relativeTime = date.from(today);

    let comment = `
      **This article was originally published ${relativeTime} and may contain out of date information.**  
      
      The original publication date was ${date.format('MMMM Do, YYYY')}. {{text}}
      &nbsp;  
      &nbsp;  
      ^(This bot finds outdated articles. It only checks certain subreddits, but) [^(this Chrome extension)](https://chrome.google.com/webstore/detail/reddit-publish-date/cfkbacelanhcgpkjaocblkpacofnccip?hl=en-US) ^(will check links on all subreddits. It's impossible to be 100% accurate on every site, and with differences in time zones and date formats this may be a little off.)

      [^(Send Feedback)](https://www.reddit.com/message/compose?to=PublishDateBot)  ^(|)  [^(Github - Bot)](https://github.com/chrisstiles/PublishDateBot)  ^(|)  [^(Github - Chrome Extension)](https://github.com/chrisstiles/Reddit-Publish-Date)
    `;

    comment = comment.replace('{{text}}', text);

    submission.reply(stripIndent(comment))
      .then(() => {
        const promises = [
          assignFlair(submission, data),
          recordCommentedSubmission(submission.id),
          sendMessage(submission, relativeTime)
        ];

        Promise.all(promises)
          .then(() => {
            resolve();
          });
      })
      .catch(error => {
        console.error(error);
        resolve();
      });
  });
}

function assignFlair(submission, data) {
  return new Promise((resolve, reject) => {
    const { flair = '', flairId = '', canModerate } = data;

    if ((flair || flairId) && canModerate) {
      submission
        .getLinkFlairTemplates()
        .then(templates => {
          let flairTemplateId = null;

          // Try to confirm 
          for (let template of templates) {
            const id = template['flair_template_id'];
            const text = template['flair_text'];

            if (id && text) {
              if (flairId && id === flairId || flair.toLowerCase() === text.toLowerCase()) {
                flairTemplateId = id;
                break;
              }
            }
          }

          // Assign correct flair to post
          if (flairTemplateId) {
            submission
              .selectFlair({ 'flair_template_id': flairTemplateId })
              .then(() => {
                resolve();
              })
              .catch(error => {
                console.log(error);
                resolve();
              });
          } else {
            console.log('Correct flair not found');
            resolve();
          }
        })
        .catch(error => {
          console.log(error);
          resolve();
        })
    } else {
      resolve();
    }
  });
}

// Send a message to me when the bot comments on a post. This will help
// me to check for incorrect dates and improve the bot's accuracy
function sendMessage(submission, relativeTime) {
  return new Promise((resolve, reject) => {
    reddit.composeMessage({
      to: 'cstiles',
      subject: `Submitted comment: article published ${relativeTime}.`,
      text: stripIndent(`
        Submission: ${submission.permalink}

        Link: ${submission.url}
      `)
    }).then(() => {
      resolve();
    })
    .catch(error => {
      console.log(error);
      resolve();
    });
  });
}

// Used to merge hot and rising listings without duplicate submissions
function mergeListings(listing1, listing2) {
  const ids = [];
  const submissions = listing1.map(submission => {
    ids.push(submission.id);
    return submission;
  });
  
  for (let submission of listing2) {
    const { id } = submission;
    if (!ids.includes(id)) {
      ids.push(id);
      submissions.push(submission);
    }
  }

  return submissions;
}

function shouldCheckSubmission({ url: postURL, media }) {
  try {
    const urlObject = new URL(postURL);
    const { hostname: url } = urlObject;
    const { invalidDomains, validMediaDomains } = config;
    
    // Do not check invalid domains
    for (let domain of invalidDomains) {
      if (url.includes(domain)) return false;
    };

    // TODO: Add functionality to dynamically set valid media domains
    // for (let domain of validMediaDomains) {
    //   if (url.includes(domain)) return true;
    // };

    // Check links that do not link to media
    return !media;
  } catch(error) {
    return false;
  }
}

function runBot() {
  const { subreddits } = config;
  const promises = [];

  subreddits.forEach(data => {
    if (!data.name || isNaN(data.time)) return;
    if (!['days', 'months'].includes(data.units)) data.units = 'days';
    
    promises.push(checkSubreddit(data));
  });

  Promise.all(promises)
    .then(() => {
      console.log('All done');
      client.end();
    });
}

runBot();