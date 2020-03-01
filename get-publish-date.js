const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const moment = require('moment');
const config = require('./bot.config');
moment.suppressDeprecationWarnings = true;

////////////////////////////
// Date Parsing
////////////////////////////

function getArticleHtml(url) {
  return fetch(url)
    .then(response => {
      const { status } = response;

      if (status === 200) {
        return response.text();
      }

      throw `Error: ${status}`;
    })
    .catch(error => {
      throw error;
    });
}

function getDateFromHTML(html, url, checkModified) {
  let date = null;

  if (url.includes('youtube.com') || url.includes('youtu.be')) return getYoutubeDate(html);

  // Create virtual HTML document to parse
  html = html.replace(/<style.*>\s?[^<]*<\/style>/g, '');
  const dom = new JSDOM(html);
  const article = dom.window.document;

  const urlObject = new URL(url);
  let { hostname } = urlObject;
  hostname = hostname.replace(/^www./, '');

  // Some websites aren't very reliable, or use 
  // selectors that may be incorrect on other sites.
  // To get around this we can set specific selectors
  // the bot should check on a particular website
  const { siteSpecificSelectors } = config;
  const selector = siteSpecificSelectors[hostname];

  if (selector && !checkModified) {
    return checkSelectors(article, html, selector);
  }

  // Some domains have incorrect dates in their
  // URLs or LD JSON. For those we only
  // check the page's markup for the date
  const { htmlOnlyDomains } = config;
  let isHTMLOnly = false;

  if (htmlOnlyDomains && htmlOnlyDomains.length) {
    for (let domain of htmlOnlyDomains) {
      if (hostname.includes(domain)) isHTMLOnly = true;
    }
  }

  // Try searching from just the HTML string with regex
  // We just look for JSON as it is not accurate to parse
  // HTML with regex, but is much faster than using the DOM
  if (!isHTMLOnly) {
    date = checkHTMLString(html, url, checkModified);
    if (date) return date;
  }

  // Attempt to get date from URL, we do this after
  // checking the HTML string because it can be inaccurate
  let urlDate = null;

  if (!isHTMLOnly && !checkModified) {
    urlDate = checkURL(url);
    if (urlDate && isRecent(urlDate, 3)) return urlDate;
  }

  // Some websites include linked data with information about the article
  date = checkLinkedData(article, url, checkModified);

  // Next try searching <meta> tags
  if (!date) date = checkMetaData(article, checkModified);

  // Try checking item props and CSS selectors
  if (!date) date = checkSelectors(article, html, null, checkModified);

  if (date) return date;
  if (urlDate) return urlDate;

  return null;
}

const jsonKeys = {
  publish: [
    'datePublished', 'dateCreated', 'publishDate', 'published', 'publishedDate',
    'articleChangeDateShort', 'post_date', 'dateText', 'date', 'publishedDateISO8601'
  ],
  modify: [
    'dateModified', 'dateUpdated', 'modified', 'modifyDate', 'lastModified', 'updated'
  ]
};

const months = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
];

function checkHTMLString(html, url, checkModified) {
  if (!html) return null;

  // Certain websites include JSON data for other posts
  // We don't attempt to parse the date from the HTML on these
  // sites to prevent the wrong date being found
  const skipDomains = ['talkingpointsmemo.com'];
  for (let domain of skipDomains) {
    if (url.includes(domain)) return null;
  }

  const arr = checkModified ? jsonKeys.modify : jsonKeys.publish;
  const regexString = `(?:(?:'|"|\\b)(?:${arr.join('|')})(?:'|")?: ?(?:'|"))([a-zA-Z0-9_.\\-:+, /]*)(?:'|")`;

  // First try with global 
  let dateTest = new RegExp(regexString, 'ig');
  let dateArray = html.match(dateTest);

  if (dateArray && dateArray.length) {
    let dateString = dateArray[0];

    // Prefer publish date over other meta data dates
    for (let date of dateArray) {
      if (date.toLowerCase().includes('publish')) {
        dateString = date;
        break;
      }
    }

    if (dateString) {
      dateArray = dateString.match(/(?:["'] ?: ?["'])([ :.a-zA-Z0-9_-]*)(?:["'])/);

      if (dateArray && dateArray[1]) {
        let date = getMomentObject(dateArray[1]);
        if (date) return date;
      }
    }
  }

  // Try matching without global flag
  dateTest = new RegExp(regexString, 'i');
  dateArray = html.match(dateTest);

  if (dateArray && dateArray[1]) {
    let date = getMomentObject(dateArray[1]);
    if (date) return date;
  }

  return null;
}

function checkURL(url) {
  const skipDomains = ['cnn.com/videos'];
  for (let domain of skipDomains) {
    if (url.includes(domain)) return null;
  }

  const dateTest = /([\./\-_]{0,1}(19|20)\d{2})[\./\-_]{0,1}(([0-3]{0,1}[0-9][\./\-_])|(\w{3,5}[\./\-_]))([0-3]{0,1}[0-9][\./\-]{0,1})/;
  let dateString = url.match(dateTest);

  if (dateString) {
    let date = getMomentObject(dateString[0]);
    if (date) return date;
  }

  const singleDigitTest = /\/(\d{8})\//;
  dateString = url.match(singleDigitTest);

  if (dateString) {
    let date = getMomentObject(dateString[0]);
    if (date) return date;
  }

  return null;
}

function getYoutubeDate(html) {
  if (!html) return null;

  const dateTest = new RegExp(`(?:["']ytInitialData[",']][.\\s\\S]*dateText["'].*)((?:${months.join('|')}) \\d{1,2}, \\d{4})(?:['"])`, 'i');
  const dateArray = html.match(dateTest);

  if (dateArray && dateArray[1]) {
    return getMomentObject(dateArray[1]);
  }

  // Parse videos where date is like "4 hours ago"
  const dateDifferenceTest = /(?:["']ytInitialData[",']][.\s\S]*dateText["'].*["'](?:\w+ )+) ?(\d+) ((?:second|minute|hour|day|month|year)s?) (?:ago)(?:['"])/i
  const dateDifferenceArray = html.match(dateDifferenceTest);

  if (dateDifferenceArray && dateDifferenceArray.length >= 3) {
    return getDateFromRelativeTime(dateDifferenceArray[1], dateDifferenceArray[2]);
  }

  return null;
}

function checkLinkedData(article, url, checkModified) {
  let linkedData = article.querySelectorAll('script[type="application/ld+json"]');
  const arr = checkModified ? jsonKeys.modify : jsonKeys.publish;

  if (linkedData && linkedData.length) {
    // Some sites have more than one script tag with linked data
    for (let node of linkedData) {
      try {
        let data = JSON.parse(node.innerHTML);

        for (let key of arr) {
          if (data[key]) {
            let date = getMomentObject(data[key]);
            if (date) return date;
          }
        }

      } catch (e) {
        // The website has invalid JSON, attempt 
        // to get the date with Regex
        let date = checkHTMLString(node.innerHTML, url, checkModified);
        if (date) return date;
      }
    }
  }

  return null;
}

const metaAttributes = {
  publish: [
    'datePublished', 'article:published_time', 'article:published', 'pubdate', 'publishdate', 'article:post_date',
    'timestamp', 'date', 'DC.date.issued', 'bt:pubDate', 'sailthru.date', 'meta', 'og:published_time', 'rnews:datePublished',
    'article.published', 'published-date', 'article.created', 'date_published', 'vr:published_time', 'video:release_date',
    'cxenseparse:recs:publishtime', 'article_date_original', 'cXenseParse:recs:publishtime',
    'DATE_PUBLISHED', 'shareaholic:article_published_time', 'parsely-pub-date', 'twt-published-at',
    'published_date', 'dc.date', 'field-name-post-date', 'posted', 'RELEASE_DATE'
  ],
  modify: [
    'dateModified', 'dateUpdated', 'modified', 'modifyDate', 'article:modified', 'article:updated', 'updatedate', 'update-date',
    'article:modify_time', 'article:update_time', 'Last-modified', 'last-modified', 'date_updated', 'date_modified'
  ]
};

function checkMetaData(article, checkModified) {
  const arr = checkModified ? metaAttributes.modify : metaAttributes.publish;
  const metaData = article.querySelectorAll('meta');
  const metaRegex = new RegExp(arr.join('|'), 'i');

  for (let meta of metaData) {
    const property = meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('itemprop') || meta.getAttribute('http-equiv');

    if (property && metaRegex.test(property)) {
      const date = getMomentObject(meta.getAttribute('content'));
      if (date) return date;
    }
  }

  return null;
}

const selectors = {
  publish: [
    'datePublished', 'published', 'pubdate', 'timestamp', 'post-date', 'post__date', 'article-date', 'article_date', 'publication-date',
    'Article__Date', 'pb-timestamp', 'meta', 'article__meta', 'post-time', 'video-player__metric', 'article-info', 'dateInfo', 'article__date',
    'Timestamp-time', 'report-writer-date', 'publish-date', 'published_date', 'byline', 'date-display-single', 'tmt-news-meta__date', 'article-source',
    'blog-post-meta', 'timeinfo-txt', 'field-name-post-date', 'post--meta', 'article-dateline', 'storydate', 'post-box-meta-single', 'nyhedsdato', 'blog_date',
    'content-head', 'news_date', 'tk-soleil', 'cmTimeStamp', 'meta p:first-child', 'entry__info', 'wrap-date-location', 'story .citation', 'ArticleTitle'
  ],
  modify: [
    'dateModified', 'dateUpdated', 'updated', 'updatedate', 'modifydate', 'article-updated', 'post__updated', 'update-date',
    'modify-date', 'update-time', 'lastupdatedtime'
  ]
};

function checkSelectors(article, html, specificSelector = null, checkModified) {
  const arr = specificSelector ? [specificSelector] :
    checkModified ? selectors.modify.slice() : selectors.publish.slice();

  // Since we can't account for every possible selector a site will use,
  // we check the HTML for CSS classes or IDs that might contain the publish date
  if (!specificSelector) {
    const possibleClassStrings = ['byline'];

    if (checkModified) {
      possibleClassStrings.push(...['update', 'modify']);
    } else {
      possibleClassStrings.push('publish');
    }

    const classTest = new RegExp(`(?:(?:class|id)=")([ a-zA-Z0-9_-]*(${possibleClassStrings.join('|')})[ a-zA-Z0-9_-]*)(?:"?)`, 'gim');

    let classMatch;
    while ((classMatch = classTest.exec(html))) {
      if (!arr.includes(classMatch[1])) {
        arr.push(classMatch[1]);
      }
    }
  }

  for (let selector of arr) {
    const selectorString = specificSelector ? specificSelector : `[itemprop^="${selector}" i], [class^="${selector}" i], [id^="${selector}" i]`;
    const elements = article.querySelectorAll(selectorString);

    // Loop through elements to see if one is a date
    if (elements && elements.length) {
      for (let element of elements) {
        const dateElement = element.querySelector('time') || element;
        const dateAttribute = dateElement.getAttribute('datetime') || dateElement.getAttribute('content');

        if (dateAttribute) {
          const date = getMomentObject(dateAttribute);
          if (date) return date;
        }

        const dateString = dateElement.innerText || dateElement.getAttribute('value');
        let date = getDateFromString(dateString);
        if (date) return date;

        date = checkChildNodes(element);
        if (date) return date;
      }
    }
  }

  if (specificSelector) {
    return null;
  }

  // Check for time elements that might be publication date
  const timeSelectors = checkModified ? 'time[updatedate], time[modifydate], time[dt-updated]' : 'article time[datetime], time[pubdate]';

  // const timeString = checkModified ? 'updatedate' : 'pubdate';
  const timeElements = article.querySelectorAll(timeSelectors);

  if (timeElements && timeElements.length) {
    for (let element of timeElements) {
      const attributes = checkModified ? ['updatedate', 'modifydate', 'dt-updated', 'datetime'] : ['pubdate', 'datetime'];
      const dateString = attributes.map(a => element.getAttribute(a)).find(d => d) || element.innerText;

      let date = getDateFromString(dateString);
      if (date) return date;

      date = checkChildNodes(element);
      if (date) return date;
    }
  }

  if (checkModified) {
    return null;
  }

  // If all else fails, try searching for very generic selectors.
  // We only use this date if there is only one occurance 
  const genericSelectors = ['.date', '#date', '.byline', '.data', '.datetime', '.submitted'];
  for (let selector of genericSelectors) {
    const elements = article.querySelectorAll(`article ${selector}, .article ${selector}, #article ${selector}, header ${selector}, ${selector}`);

    if (elements.length === 1) {
      let date = getDateFromString(elements[0].innerText);
      if (date) return date;

      date = checkChildNodes(elements[0]);
      if (date) return date;
    }
  }

  return null;
}

function checkChildNodes(parent) {
  if (!parent.hasChildNodes()) return null;

  const children = parent.childNodes;

  for (let i = 0; i < children.length; i++) {
    const text = children[i].textContent.trim();
    const date = getDateFromString(text);

    if (date) return date;
  }

  return null;
}

function getDateFromParts(string) {
  if (!string || typeof string !== 'string') return null;
  let year, day, month;
  const dateArray = string.replace(/[\.\/-]/g, '-').split('-');
  if (dateArray && dateArray.length === 3) {
    for (let datePart of dateArray) {
      if (datePart.length === 4) {
        year = datePart;
      }
    }

    if (!year) year = dateArray[dateArray.length - 1];

    const parts = dateArray.reduce((filtered, part) => {
      if (part !== year) {
        filtered.push(Number(part));
      }

      return filtered;
    }, []);

    if (parts[0] > 12) {
      day = parts[0];
      month = parts[1];
    } else if (parts[1] > 12) {
      day = parts[1];
      month = parts[0];
    } else {
      const today = moment();
      const currentMonth = today.month();
      const currentDay = today.date();

      if (parts[0] === currentDay && parts[1] === currentMonth) {
        day = parts[0];
        month = parts[1];
      } else if (parts[1] === currentDay && parts[0] === currentMonth) {
        day = parts[1];
        month = parts[0];
      } else {
        day = parts[0];
        month = parts[1];
      }
    }

    return `${month}-${day}-${year}`;
  }

  return null;
}

function getDateFromString(string) {
  if (!string || !string.trim()) return null;
  string = string.trim();

  let date = getMomentObject(string);
  if (date) return date;

  date = getMomentObject(getDateFromParts(string));
  if (date) return date;

  const numberDateTest = /\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{1,4}/;
  let dateString = string.match(numberDateTest);
  if (dateString) date = getMomentObject(dateString[0]);
  if (date) return date;

  dateString = string.match(/(?:published):? (.*$)/i)
  if (dateString) date = getMomentObject(dateString[1]);
  if (date) return date;

  const stringDateTest = new RegExp(`/(${months.join('|')})\w*\b \d{1,2},? {1,2}(\d{4}|\d{2})/i`, 'i');
  dateString = string.match(stringDateTest);
  if (dateString) date = getMomentObject(dateString[0]);
  if (date) return date;

  dateString = string
    .replace(/at|on|,/g, '')
    .replace(/(\d{4}).*/, '$1')
    .replace(/([0-9]st|nd|th)/g, '')
    .replace(/posted:*/i, '')
    .replace(/.*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, '')
    .trim();

  date = getMomentObject(dateString);
  if (date) return date;

  return null;
}

////////////////////////////
// Date Helpers
////////////////////////////

function getMomentObject(dateString) {
  if (!dateString) return null;
  if (dateString.length && dateString.length > 35) return null;

  let date = moment(dateString);
  if (isValid(date)) return date;

  dateString = dateString.replace(/\|/g, '').replace(/(\d+)(st|nd|rd|th)/g, '$1').trim();

  // Try to account for strangly formatted dates
  const timezones = ['est', 'cst', 'mst', 'pst', 'edt', 'cdt', 'mdt', 'pdt'];

  for (let timezone of timezones) {
    if (dateString.toLowerCase().includes(timezone)) {
      date = moment(dateString.substring(0, dateString.indexOf(timezone)));
      if (isValid(date)) return date;
    }
  }

  for (let month of months) {
    if (dateString.toLowerCase().includes(month)) {
      const monthSearch = new RegExp(`(\\d{1,4} )?${month}`);
      const startIndex = dateString.search(monthSearch)
      const yearIndex = dateString.search(/\d{4}/);
      const endIndex = yearIndex === -1 ? dateString.length : yearIndex + 4;

      date = moment(dateString.substring(startIndex, endIndex));
      if (isValid(date)) return date;
    }
  }

  // Some invalid date strings include the date without formatting
  let digitDate = dateString.replace(/[ \.\/-]/g, '');
  const dateNumbers = parseDigitOnlyDate(digitDate);

  if (dateNumbers) {
    date = moment(dateNumbers);
    if (isValid(date)) return date;
  }

  // Use today's date if the string contains 'today'
  if (dateString.includes('today')) {
    return moment();
  }

  // Could not parse date from string
  return null;
}

function getDateFromRelativeTime(num, units) {
  if ((!num && num !== 0) || !units) return null;
  if (!isNaN(num) && typeof units === 'string') {
    const date = moment().subtract(num, units);
    if (isValid(date)) return date;
  }

  return null;
}

function parseDigitOnlyDate(dateString) {
  if (!dateString) return null;

  let matchedDate = dateString.replace(/\/|-\./g, '').match(/\b(\d{6}|\d{8})\b/);

  if (!matchedDate) {
    matchedDate = dateString.match(/\d{8}/);
    if (!matchedDate) {
      return null;
    } else {
      return matchedDate[0];
    }
  }

  dateString = matchedDate[0];

  if (dateString.length === 6) {
    const dateArray = dateString.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3').split('-');

    // Some date formats include the day before the month (i.e. 25-12-2020).
    // On a digit only date we don't really have a way of knowing
    // which is first, so all we can do is guess by checking if 
    // the first number is greater than 12 (meaning it can't be a month)
    const dayFirst = Number(dateArray[0]) > 12;
    const day = dayFirst ? dateArray[0] : dateArray[1];
    const month = (dayFirst ? dateArray[1] : dateArray[0]);
    const year = dateArray[2];
    const date = getDateFromParts(`${month}-${day}-${year}`);
    if (date && isValid(date)) return date;
  } else {
    let date = getDateFromParts(dateString.replace(/(\d{2})(\d{2})(\d{4})/, '$1-$2-$3'));
    if (date && isValid(date)) return date;

    date = getDateFromParts(dateString.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
    if (date && isValid(date)) return date;
  }

  return null;
}

function isValid(date) {
  if (!moment.isMoment(date)) date = moment(date);
  const input = date._i;
  if (!input) return false;

  // Check if the date is on or before tomorrow to account for time zone differences
  const tomorrow = moment().add(1, 'd');
  const longAgo = moment().subtract(20, 'y');
  const inputLength = date._i.length;
  const digits = date._i.match(/\d/g);
  const digitLength = !digits ? 0 : digits.length;

  return (
    date.isValid() &&
    date.isSameOrBefore(tomorrow, 'd') &&
    date.isSameOrAfter(longAgo) &&
    inputLength >= 5 &&
    digitLength >= 3
  );
}

function isRecent(date, difference = 31) {
  if (!date) return false;
  if (!moment.isMoment(date)) date = getMomentObject(date);

  const tomorrow = moment().add(1, 'd');
  const lastMonth = tomorrow.clone().subtract(difference, 'd');

  return date.isValid() && date.isBetween(lastMonth, tomorrow, 'd', '[]');
}

// Find the publish date from a passed URL 
function getPublishDate(url, checkModified) {
  return new Promise((resolve, reject) => {
    try {
      const urlObject = new URL(url);

      getArticleHtml(urlObject)
        .then(html => {
          if (!html) reject('Error fetching HTML');

          const data = {
            publishDate: getDateFromHTML(html, url),
            modifyDate: checkModified ? getDateFromHTML(html, url, true) : null
          };

          if (data.publishDate) {
            resolve(data);
          } else {
            reject('No date found');
          }
        })
        .catch(error => {
          reject(error);
        });
    } catch (error) {
      reject(`Invalid URL: ${url}`);
    }
  });
}

if (process.argv[2]) {
  const checkModified = process.argv[3] === 'true';

  getPublishDate(process.argv[2], checkModified)
    .then(({ publishDate, modifyDate }) => {
      publishDate = publishDate ? publishDate.format('YYYY-MM-DD') : null;
      modifyDate = modifyDate ? modifyDate.format('YYYY-MM-DD') : null;
      console.log({ publishDate, modifyDate });
    });
}

module.exports = { getPublishDate, months };