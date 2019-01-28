const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const moment = require('moment');
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

function getDateFromHTML(html, url) {
  let publishDate = null;

  if (url.includes('youtube.com') || url.includes('youtu.be')) return getYoutubeDate(html);

  // Try searching from just the HTML string with regex
  // We just look for JSON as it is not accurate to parse
  // HTML with regex, but is much faster than using the DOM
  publishDate = checkHTMLString(html, url);
  if (publishDate) return publishDate;

  // Attempt to get date from URL, we do this after
  // checking the HTML string because it can be inaccurate
  const urlDate = checkURL(url);
  if (urlDate && isRecent(urlDate, 3)) return urlDate;

  // Create virtual HTML document to parse
  const dom = new JSDOM(html);
  const article = dom.window.document;

  // Some websites include linked data with information about the article
  publishDate = checkLinkedData(article, url);

  // Next try searching <meta> tags
  if (!publishDate) publishDate = checkMetaData(article);

  // Try checking item props and CSS selectors
  if (!publishDate) publishDate = checkSelectors(article, html);

  if (publishDate) return publishDate;
  if (urlDate) return urlDate;

  return null;
}

const possibleKeys = [
  'datePublished', 'dateCreated', 'publishDate', 'published', 'publishedDate',
  'articleChangeDateShort', 'post_date', 'dateText', 'date', 'publishedDateISO8601'
];
const months = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
]

function checkHTMLString(html, url) {
  if (!html) return null;

  // Certain websites include JSON data for other posts
  // We don't attempt to parse the date from the HTML on these
  // sites to prevent the wrong date being found
  const skipDomains = ['talkingpointsmemo.com'];
  for (let domain of skipDomains) {
    if (url.includes(domain)) return null;
  }

  const regexString = `(?:(?:'|"|\\b)(?:${possibleKeys.join('|')})(?:'|")?: ?(?:'|"))([a-zA-Z0-9_.\\-:+, /]*)(?:'|")`;

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


function checkLinkedData(article, url) {
  let linkedData = article.querySelectorAll('script[type="application/ld+json"]');

  if (linkedData && linkedData.length) {
    // Some sites have more than one script tag with linked data
    for (let node of linkedData) {
      try {
        let data = JSON.parse(node.innerHTML);

        for (let key of possibleKeys) {
          if (data[key]) {
            let date = getMomentObject(data[key]);
            if (date) return date;
          }
        }

      } catch (e) {
        // The website has invalid JSON, attempt 
        // to get the date with Regex
        for (let key of possibleKeys) {
          let date = checkHTMLString(node.innerHTML, url);
          if (date) return date;
        }
      }
    }
  }

  return null;
}

function checkMetaData(article) {
  const possibleProperties = [
    'datePublished', 'article:published_time', 'article:published', 'pubdate', 'publishdate', 'article:post_date',
    'timestamp', 'date', 'DC.date.issued', 'bt:pubDate', 'sailthru.date', 'meta', 'og:published_time', 'rnews:datePublished',
    'article.published', 'published-date', 'article.created', 'date_published', 'vr:published_time', 'video:release_date',
    'cxenseparse:recs:publishtime', 'article_date_original', 'cXenseParse:recs:publishtime',
    'DATE_PUBLISHED', 'shareaholic:article_published_time', 'parsely-pub-date', 'twt-published-at',
    'published_date', 'dc.date', 'field-name-post-date', 'Last-modified', 'posted', 'RELEASE_DATE'
  ];

  const metaData = article.querySelectorAll('meta');
  const metaRegex = new RegExp(possibleProperties.join('|'), 'i');

  for (let meta of metaData) {
    const property = meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('itemprop') || meta.getAttribute('http-equiv');

    if (property && metaRegex.test(property)) {
      const date = getMomentObject(meta.getAttribute('content'));
      if (date) return date;
    }
  }

  // Check page title
  // const title = article.querySelector('title');
  // if (title && title.innerText.match(/([^\d]*\d){8}/)) {
  //   const date = getDateFromString(title.innerText);
  //   if (date) return date;
  // }

  return null;
}

function checkSelectors(article, html) {
  const possibleSelectors = [
    'datePublished', 'published', 'pubdate', 'timestamp', 'post-date', 'post__date', 'article-date', 'article_date', 'publication-date',
    'Article__Date', 'pb-timestamp', 'meta', 'lastupdatedtime', 'article__meta', 'post-time', 'video-player__metric', 'article-info', 'dateInfo', 'article__date',
    'Timestamp-time', 'report-writer-date', 'publish-date', 'published_date', 'byline', 'date-display-single', 'tmt-news-meta__date', 'article-source',
    'blog-post-meta', 'timeinfo-txt', 'field-name-post-date', 'post--meta', 'article-dateline', 'storydate', 'post-box-meta-single', 'nyhedsdato', 'blog_date',
    'content-head', 'news_date', 'tk-soleil', 'cmTimeStamp', 'meta p:first-child', 'entry__info', 'wrap-date-location', 'story .citation', 'ArticleTitle'
  ];

  // Since we can't account for every possible selector a site will use,
  // we check the HTML for CSS classes or IDs that might contain the publish date
  const possibleClassStrings = ['publish', 'byline'];
  const classTest = new RegExp(`(?:(?:class|id)=")([ a-zA-Z0-9_-]*(${possibleClassStrings.join('|')})[ a-zA-Z0-9_-]*)(?:"?)`, 'gim');

  let classMatch;
  while (classMatch = classTest.exec(html)) {
    if (!possibleSelectors.includes(classMatch[1])) {
      possibleSelectors.push(classMatch[1]);
    }
  }

  for (let selector of possibleSelectors) {
    const selectorString = `[itemprop^="${selector}" i], [class^="${selector}" i], [id^="${selector}" i]`;
    const elements = article.querySelectorAll(selectorString);

    // Loop through elements to see if one is a date
    if (elements && elements.length) {
      for (let element of elements) {
        const dateElement = element.querySelector('time') || element;
        const dateAttribute = dateElement.getAttribute('datetime') || dateElement.getAttribute('content');

        if (dateAttribute) {
          const date = getMomentObject(dateAttribute);
          if (date) {
            if (date) return date;
          };
        }

        // dateElement.innerHTML = stripScripts(dateElement.innerHTML)

        const dateString = dateElement.innerText || dateElement.getAttribute('value');
        let date = getDateFromString(dateString);
        if (date) return date;

        date = checkChildNodes(element);
        if (date) return date;
      }
    }
  }

  // function stripScripts(html) {
  //   let div = document.createElement('div');
  //   div.innerHTML = html;
  //   let scripts = div.getElementsByTagName('script');
  //   let i = scripts.length;
  //   while (i--) {
  //     scripts[i].parentNode.removeChild(scripts[i]);
  //   }
  //   return div.innerHTML;
  // }

  // Check for time elements that might be publication date
  const timeElements = article.querySelectorAll('article time[datetime], time[pubdate]');
  if (timeElements && timeElements.length) {
    for (let element of timeElements) {
      element.getAttribute('datetime') || element.getAttribute('pubdate')
      const dateString = element.getAttribute('datetime') || element.innerText;
      let date = getDateFromString(dateString);
      if (date) return date;

      date = checkChildNodes(element);
      if (date) return date;
    }
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

  let day, month, year, dayMonthArray;
  dateString = matchedDate[0];

  if (dateString.length === 6) {
    const dateArray = dateString.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3').split('-');

    if (Number(dateArray[0]) > 12) {
      dayMonthArray = [dateArray[1], dateArray[0]];
    } else {
      dayMonthArray = [dateArray[0], dateArray[1]];
    }

    year = dateArray[2];
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

function isToday(date) {
  if (!date) return false;
  if (!moment.isMoment(date)) date = getMomentObject(date);

  const today = moment();

  return date.isValid() && date.isSame(today, 'd');
}

function isRecent(date, difference = 31) {
  if (!date) return false;
  if (!moment.isMoment(date)) date = getMomentObject(date);

  const tomorrow = moment().add(1, 'd');
  const lastMonth = tomorrow.clone().subtract(difference, 'd');

  return date.isValid() && date.isBetween(lastMonth, tomorrow, 'd', '[]');
}


// function formatDate(date) {
//   if (!date) return null;
//   if (!moment.isMoment(date)) date = getMomentObject(date);
//   if (!isValid(date)) return null;

//   const { dateType, dateFormat } = options;
//   if (dateType === 'date') {
//     return date.format(dateFormat);
//   } else {
//     return getRelativeDate(date);
//   }
// }

function getRelativeDate(date) {
  const startOfPublishDate = date.clone().startOf('d')
  const today = moment();
  const yesterday = moment().subtract(1, 'd').startOf('d');

  if (date.isSameOrAfter(today, 'd')) {
    return 'today';
  } else if (date.isSame(yesterday, 'd')) {
    return 'yesterday';
  } else {
    return startOfPublishDate.from(today.startOf('d'));
  }
}


// Find the publish date from a passed URL 
function getPublishDate(url) {
  return new Promise((resolve, reject) => {
    try {
      const urlObject = new URL(url);

      getArticleHtml(urlObject)
        .then(html => {
          if (!html) reject('Error fetching HTML');

          const htmlDate = getDateFromHTML(html, url);
          if (htmlDate) {
            // resolve(htmlDate.format('MMMM Do, YYYY'));
            resolve(getRelativeDate(htmlDate));
          } else {
            reject('No date found')
          }
        })
      .catch(error => {
        reject(error);
      });
    } catch(error) {
      reject(`Invalid URL: ${url}`);
    }
  });
}

module.exports = getPublishDate;