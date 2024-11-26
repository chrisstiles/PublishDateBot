import parser from './DateParser.js';
import { log, config, includesUrl, isMediaLink } from './util.js';
import { ignoreDomains } from './data/index.js';
import { months } from './data/index.js';
import Promise from 'bluebird';
import moment from 'moment';
import stripIndent from 'strip-indent';
import snoowrap from 'snoowrap';
import dotenv from 'dotenv';

///////////////////////
// Initialize
///////////////////////

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
const refreshToken = process.env.REDDIT_REFRESH_TOKEN;

///////////////////////
// Reddit
///////////////////////

// Set up Reddit client
const reddit = new snoowrap({
  userAgent: 'Article publish date bot (by /u/PublishDateBot)',
  clientId,
  clientSecret,
  refreshToken
});

reddit.config({
  continueAfterRatelimitError: true
});

// TODO Replace remaining promise chains with async/await

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
            const { time, units } = config.submissionThreshold;
            const threshold = moment.utc().subtract(time, units);
            const submissions = mergeListings(hotListing, risingListing).filter(
              submission => {
                return moment
                  .utc(submission.created_utc, 'X')
                  .isAfter(threshold);
              }
            );

            resolve(submissions);
          })
          .catch(error => {
            log(error);
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
          canModerate =
            permissions.includes('all') || permissions.includes('flair');
        }

        resolve(canModerate);
      })
      .catch(error => {
        log(error);
        resolve(false);
      });
  });
}

// Filters submissions the bot has already replied to
function filterSubmissions(submissions, botActivity) {
  return !submissions || !submissions.length
    ? []
    : submissions.filter(submission => {
        return !botActivity.submissionIds.includes(submission.id);
      });
}

// Checks recent postings on a specific subreddit
// and comments if an out of date link is found
async function checkSubreddit(data, botActivity) {
  return new Promise((resolve, reject) => {
    try {
      checkModStatus(data).then(canModerate => {
        data.canModerate = canModerate;

        getSubmissions(data.name).then(mergedSubmissions => {
          if (!mergedSubmissions || !mergedSubmissions.length) {
            resolve();
            return;
          }

          Promise.map(
            filterSubmissions(mergedSubmissions, botActivity),
            submission => {
              return new Promise(resolve => {
                checkSubmission(submission, data)
                  .then(resolve)
                  .catch(error => {
                    log(error);
                    resolve();
                  });
              });
            },
            { concurrency: 1 }
          ).then(resolve);
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

function checkSubmission(submission, data) {
  return new Promise((resolve, reject) => {
    const { url, created_utc: createdUTC } = submission;

    if (shouldCheckSubmission(submission, data)) {
      const { time, units, ignoreModified } = data;

      parser
        .get(url, {
          checkModified: !ignoreModified,
          priority: 2,
          enablePuppeteer: true
        })
        .then(result => {
          let { publishDate, modifyDate } = result;

          if (!publishDate) return reject(result);

          publishDate = moment(publishDate.format('YYYY-MM-DD'));
          const postDate = moment(
            moment.utc(createdUTC, 'X').format('YYYY-MM-DD')
          );

          const outdatedDate = postDate.subtract(time, units);

          if (publishDate.isBefore(outdatedDate, 'd')) {
            if (!ignoreModified && modifyDate) {
              modifyDate = moment(modifyDate.format('YYYY-MM-DD'));

              if (
                modifyDate.isAfter(outdatedDate, 'd') &&
                modifyDate.isAfter(publishDate, 'd')
              ) {
                return resolve();
              }
            }

            submitComment(submission, publishDate, modifyDate, data, url)
              .then(resolve)
              .catch(reject);
          } else {
            resolve();
          }
        })
        .catch(reject);
    } else {
      resolve();
    }
  });
}

async function hasPreviouslyReplied(submission) {
  const checkParticipants = post => {
    const participants = post.comments.map(({ author }) => author.name);
    return participants.includes('PublishDateBot');
  };

  // First if the bot is included in the initial list
  // of participants to avoid unecessary API request
  // to get the full list of post replies
  return (
    checkParticipants(submission) ||
    checkParticipants(await submission.expandReplies({ depth: 1 }))
  );
}

async function submitComment(submission, publishDate, modifyDate, data) {
  const hasReplied = await hasPreviouslyReplied(submission);

  if (hasReplied) {
    return;
  }

  const text = data.text ? ` ${data.text}` : '';
  const today = moment(moment().format('YYYY-MM-DD'));
  let dateText,
    modifyText = '';
  let relativeTime;

  if (
    !data.ignoreModified &&
    modifyDate &&
    modifyDate.isAfter(publishDate, 'd')
  ) {
    relativeTime = modifyDate.from(today);
    dateText = `last modified ${relativeTime}`;
    modifyText = ` and it was last updated on ${modifyDate.format(
      'MMMM Do, YYYY'
    )}`;
  } else {
    relativeTime = publishDate.from(today);
    dateText = `originally published ${relativeTime}`;
  }

  // Reddit encodes URLs on their end, but certain characters
  // are omitted so we encode those ourselves
  const encode = str => str.replace(/\(/g, '%28').replace(/\)/g, '%29');

  const feedbackUrl = [
    'https://www.reddit.com/message/compose?to=PublishDateBot',
    'subject=Feedback',
    `message=${encode(submission.url)}`,
    `u=${submission.author.name}`,
    `d=${today.diff(publishDate, 'd')}`
  ].join('&');

  const comment = `
    **This article was ${dateText} and may contain out of date information.**  
    
    The original publication date was ${publishDate.format(
      'MMMM Do, YYYY'
    )}${modifyText}.${text}
    &nbsp;  
    &nbsp;  
    
    ^(This bot finds outdated articles. It's impossible to be 100% accurate on every site, send me a message if you notice an error or would like this bot added to your subreddit. You can download my Chrome Extension if you'd like publish date labels added to article links on all subreddits.)
    
    [Chrome Extension](https://chrome.google.com/webstore/detail/reddit-publish-date/cfkbacelanhcgpkjaocblkpacofnccip?hl=en)  |  [GitHub](https://github.com/chrisstiles/PublishDateBot)  |  [Send Feedback](${feedbackUrl})
  `;

  await submission.reply(stripIndent(comment));

  try {
    await sendMessage(submission, relativeTime, publishDate, modifyDate);
    await assignFlair(submission, data);
  } catch (error) {
    log(error);
  }
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
              if (
                (flairId && id === flairId) ||
                flair.toLowerCase() === text.toLowerCase()
              ) {
                flairTemplateId = id;
                break;
              }
            }
          }

          // Assign correct flair to post
          if (flairTemplateId) {
            submission
              .selectFlair({ flair_template_id: flairTemplateId })
              .then(resolve)
              .catch(reject);
          } else {
            reject('Correct flair not found');
          }
        })
        .catch(reject);
    } else {
      resolve();
    }
  });
}

// Send a message to me when the bot comments on a post. This will help
// me to check for incorrect dates and improve the bot's accuracy
function sendMessage(submission, relativeTime, publishDate, modifyDate) {
  const hasModifyDate = modifyDate && modifyDate.isAfter(publishDate, 'd');

  if (!shouldSendMessage(hasModifyDate ? modifyDate : publishDate)) {
    return Promise.resolve();
  }

  const modifyText = hasModifyDate
    ? modifyDate.format('MMMM Do, YYYY')
    : 'None';

  return new Promise((resolve, reject) => {
    reddit
      .composeMessage({
        to: 'cstiles',
        subject: `Submitted comment: article published ${relativeTime}.`,
        text: stripIndent(`
        Submission: ${submission.permalink}

        Link: ${submission.url}

        Publish Date: ${publishDate.format('MMMM Do, YYYY')}
        
        Modify Date: ${modifyText}
      `)
      })
      .then(resolve)
      .catch(reject);
  });
}

// Only send me messages when the date is older than a configured
// threshold so that I don't constantly receive notifications from the bot
function shouldSendMessage(date) {
  if (!config.messageThreshold || !date) {
    return true;
  }

  const { time, units } = config.messageThreshold;
  const threshold = moment().subtract(time, units);

  return date.isBefore(threshold);
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

function shouldCheckSubmission({ url: postURL, media, title }, { regex }) {
  if (hasApprovedTitle(title, regex)) return false;
  if (isMediaLink(postURL)) return false;

  try {
    const urlObject = new URL(postURL);
    const { hostname: pathname } = urlObject;

    // Do not check root domains
    if (pathname === '/') return false;

    // Do not check certain domains
    if (includesUrl(ignoreDomains, urlObject)) return false;

    // Check links that do not link to media
    return !media;
  } catch (error) {
    return false;
  }
}

async function getBotActivity() {
  const filterComments = replies => {
    return replies
      .filter(reply => reply.parent_id === reply.link_id)
      .sort((a, b) => b.created_utc - a.created_utc);
  };

  const { time, units } = config.submissionThreshold;
  const threshold = moment.utc().subtract(time + 1, units);
  const bot = await reddit.getUser('PublishDateBot');

  let comments = filterComments(await bot.getComments()) || [];

  if (!comments.length) {
    return {
      mostRecentCommentTime: threshold,
      submissionIds: []
    };
  }

  const hasEnoughComments = () => {
    if (comments.isFinished || comments.length < 2) {
      return true;
    }

    const oldestComment = comments[comments.length - 1];

    return moment.utc(oldestComment.created_utc, 'X').isBefore(threshold);
  };

  while (!hasEnoughComments()) {
    comments = filterComments(await comments.fetchMore()) || [];
  }

  return {
    mostRecentCommentTime: moment.utc(comments[0].created_utc, 'X'),
    submissionIds: comments.map(comment => comment.link_id.replace(/^t\d_/, ''))
  };
}

// Some subreddits allow older posts as long as they
// include the date in the title in a specific format
function hasApprovedTitle(title, regex) {
  if (!title || !regex) return false;
  const regexString = regex.replace('<month>', `(${months.join('|')})`);
  return !!title.match(new RegExp(regexString, 'i'));
}

async function runBot() {
  const { subreddits = [] } = config;
  const botActivity = await getBotActivity();

  const createPromise = data => {
    if (!data.name || isNaN(data.time)) return Promise.resolve();
    if (!['days', 'months', 'weeks'].includes(data.units)) data.units = 'days';

    return new Promise(resolve => {
      checkSubreddit(data, botActivity)
        .then(resolve)
        .catch(error => {
          log(error);
          resolve();
        });
    });
  };

  Promise.map(subreddits, createPromise, { concurrency: 1 })
    .then(() => console.log('All done!'))
    .finally(async () => await parser.close(true));
}

runBot();
