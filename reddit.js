///////////////////////
// Initialize 
///////////////////////

const config = require('./bot.config');
const { getPublishDate, months } = require('./get-publish-date');
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
  return new Promise(resolve => {
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

  return new Promise(resolve => {
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
  return new Promise(resolve => {
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
  return new Promise(resolve => {
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
  return new Promise(resolve => {
    const { url, created_utc: createdUTC } = submission;

    if (shouldCheckSubmission(submission, data)) {
      const { time, units, ignoreModified } = data;

      getPublishDate(url, !ignoreModified)
        .then(({ publishDate, modifyDate }) => {
          publishDate = moment(publishDate.format('YYYY-MM-DD'));
          const postDate = moment(moment.utc(createdUTC, 'X').format('YYYY-MM-DD'));
          const outdatedDate = postDate.subtract(time, units);
          
          if (publishDate.isBefore(outdatedDate, 'd')) {
            console.log('SHOULD COMMENT:');
            console.log(`Date: ${publishDate}`)
            console.log(`URL: ${url}`);
            resolve();
            return;

            // if (!ignoreModified && modifyDate) {
            //   modifyDate = moment(modifyDate.format('YYYY-MM-DD'));

            //   if (modifyDate.isAfter(outdatedDate, 'd') && modifyDate.isAfter(publishDate, 'd')) {
            //     resolve();
            //     return;
            //   }
            // }

            // submitComment(submission, publishDate, modifyDate, data, url)
            //   .then(() => {
            //     resolve();
            //   })
            //   .catch(error => {
            //     console.error(error);
            //     resolve();
            //   });
          } else {
            resolve();
          }

        })
        .catch(error => {
          // console.error(`${error}: ${url}`);
          resolve(error);
        })
    } else {
      resolve();
    }
  });
}

function submitComment(submission, publishDate, modifyDate, data) {
  return new Promise(resolve => {
    const text = data.text ? ` ${data.text}` : '';
    const today = moment(moment().format('YYYY-MM-DD'));
    let dateText, modifyText = '';
    let relativeTime;

    if (!data.ignoreModified && modifyDate && modifyDate.isAfter(publishDate, 'd')) {
      relativeTime = modifyDate.from(today);
      dateText = `last modified ${relativeTime}`;
      modifyText = ` and it was last updated on ${modifyDate.format('MMMM Do, YYYY')}`;
    } else {
      relativeTime = publishDate.from(today);
      dateText = `originally published ${relativeTime}`;
    }

    const comment = `
      **This article was ${dateText} and may contain out of date information.**  
      
      The original publication date was ${publishDate.format('MMMM Do, YYYY')}${modifyText}.${text}
      &nbsp;  
      &nbsp;  
      ^(This bot finds outdated articles. It's impossible to be 100% accurate on every site, and with differences in time zones and date formats this may be a little off. Send me a message if you notice an error or would like this bot added to your subreddit.)

      [^(Send Feedback)](https://www.reddit.com/message/compose?to=PublishDateBot)  ^(|)  [^(Github - Bot)](https://github.com/chrisstiles/PublishDateBot)  ^(|)  [^(Github - Chrome Extension)](https://github.com/chrisstiles/Reddit-Publish-Date)
    `;

    resolve();

    submission.reply(stripIndent(comment))
      .then(() => {
        const promises = [
          assignFlair(submission, data),
          recordCommentedSubmission(submission.id),
          sendMessage(submission, relativeTime, publishDate, modifyDate)
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
  return new Promise(resolve => {
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
function sendMessage(submission, relativeTime, publishDate, modifyDate) {
  const modifyText = 
    modifyDate && modifyDate.isAfter(publishDate, 'd') ?
    modifyDate.format('MMMM Do, YYYY') : 'None';

  return new Promise(resolve => {
    reddit.composeMessage({
      to: 'cstiles',
      subject: `Submitted comment: article published ${relativeTime}.`,
      text: stripIndent(`
        Submission: ${submission.permalink}

        Link: ${submission.url}

        Publish Date: ${publishDate.format('MMMM Do, YYYY')}
        
        Modify Date: ${modifyText}
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

const ignoreDomains = require('./data/ignore.json');

function shouldCheckSubmission({ url: postURL, media, title }, { regex }) {
  if (hasApprovedTitle(title, regex)) return false;

  try {
    const urlObject = new URL(postURL);
    const { hostname: url } = urlObject;
    
    // Do not check certain domains
    for (let domain of ignoreDomains) {
      if (url.includes(domain)) return false;
    }

    // Check links that do not link to media
    return !media;
  } catch(error) {
    return false;
  }
}

// Some subreddits allow older posts as long as they
// include the date in the title in a specific format
function hasApprovedTitle(title, regex) {
  if (!title || !regex) return false;
  const regexString = regex.replace('<month>', `(${months.join('|')})`)
  return !!title.match(new RegExp(regexString, 'i'));
}

function runBot() {
  const { subreddits } = config;
  const promises = [];

  subreddits.forEach(data => {
    if (!data.name || isNaN(data.time)) return;
    if (!['days', 'months', 'weeks'].includes(data.units)) data.units = 'days';
    
    promises.push(checkSubreddit(data));
  });

  Promise.all(promises)
    .then(() => {
      console.log('All done');
      client.end();
    });
}

runBot();