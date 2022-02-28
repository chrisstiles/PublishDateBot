import jsdom from 'jsdom';
import moment from 'moment';
import _ from 'lodash';
import Promise from 'bluebird';
import { log as writeLog, fetchTimeout, freeRegExp } from './util.js';

import {
  htmlOnlyDomains,
  jsonKeys,
  metaAttributes,
  months,
  selectors,
  sites,
  tlds
} from './data/index.js';

const { JSDOM } = jsdom;

moment.suppressDeprecationWarnings = true;

////////////////////////////
// Logging
////////////////////////////

// Only log messages for successful date parsing
// when this script is called directly
let shouldLogDateMethod = false;

function log(message, isErrorLog) {
  if (isErrorLog || shouldLogDateMethod) {
    writeLog(message);
  }
}

////////////////////////////
// Date Parsing
////////////////////////////

function getArticleHtml(url, shouldSetUserAgent) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'text/html'
      },
      insecureHTTPParser: true,
      highWaterMark: 1024 * 1024
    };

    if (shouldSetUserAgent) {
      options.headers['User-Agent'] =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36';
    }

    fetchTimeout(url, 30000, options)
      .then(async response => {
        if (response.status === 200) {
          resolve(await response.text());
          return;
        }

        reject(`status code ${response.status}, URL: ${url}`);
      })
      .catch(error => {
        reject(`${error}, ${url}`);
      });
  });
}

let searchMethod = null;

function getDateFromHTML(html, url, checkModified, dom) {
  searchMethod = null;
  let date = null;

  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    searchMethod = 'YouTube';
    return { date: getYoutubeDate(html), dom: null };
  }

  // Create virtual HTML document to parse
  if (!dom) {
    html = html
      .replace(/<style.*>\s?[^<]*<\/style>/g, '')
      .replace(/<style/g, '<disbalestyle')
      .replace(/<\/style /g, '</disablestyle');

    dom = new JSDOM(html);
  }

  const article = dom.window.document;
  const urlObject = new URL(url);
  const hostname = urlObject.hostname.replace(/^www./, '');

  // We can add site specific methods for
  // finding publish dates. This is helpful
  // for websites with incorrect/inconsistent
  // ways of displaying publish dates
  const site = sites[hostname];

  if (site && !checkModified) {
    searchMethod = 'Site specific';

    // String values refer to selectors
    if (typeof site === 'string') {
      return { date: checkSelectors(article, html, site, false, url), dom };
    }

    if (typeof site === 'object' && site.key) {
      // Some websites have different layouts for different
      // sections of the website (i.e. /video/).
      let { path, key, method = 'selector' } = site;

      // If URL is on the same site, but a different path we
      // will continue checking the data normally.
      if (
        method &&
        (!path || urlObject.pathname.match(new RegExp(path, 'i')))
      ) {
        if (method === 'html') {
          return { date: checkHTMLString(html, url, false, key), dom };
        }

        if (method === 'selector') {
          return { date: checkSelectors(article, html, site, false, url), dom };
        }

        if (method === 'linkedData') {
          return { date: checkLinkedData(article, html, false, key), dom };
        }

        return { date: null, dom };
      }
    } else {
      return { date: null, dom };
    }
  }

  // Some domains have incorrect dates in their
  // URLs or LD JSON. For those we only
  // check the page's markup for the date
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

    if (date) {
      searchMethod = 'HTML string';
      return { date, dom };
    }
  }

  // Attempt to get date from URL, we do this after
  // checking the HTML string because it can be inaccurate
  let urlDate = null;

  if (!isHTMLOnly && !checkModified) {
    urlDate = checkURL(url);

    if (urlDate && isRecent(urlDate, 3, url)) {
      searchMethod = 'Recent URL date';
      return { date: urlDate, dom };
    }
  }

  // Some websites include linked data with information about the article
  date = checkLinkedData(article, url, checkModified);

  if (date) {
    searchMethod = 'Linked data';
    return { date, dom };
  }

  // Next try searching <meta> tags
  date = checkMetaData(article, checkModified, url);

  if (date) {
    searchMethod = 'Metadata';
    return { date, dom };
  }

  // Try checking item props and CSS selectors
  date = checkSelectors(article, html, null, checkModified, url);

  if (date) {
    searchMethod = 'Selectors';
    return { date, dom };
  }

  // if (date) return date;
  if (urlDate) {
    searchMethod = 'Older URL date';
    return { date: urlDate, dom };
  }

  return { date: null, dom };
}

function checkHTMLString(html, url, checkModified, key) {
  if (!html) return null;

  // Certain websites include JSON data for other posts
  // We don't attempt to parse the date from the HTML on these
  // sites to prevent the wrong date being found
  const skipDomains = ['talkingpointsmemo.com'];
  for (let domain of skipDomains) {
    if (url.includes(domain)) return null;
  }

  const arr = key ? [key] : checkModified ? jsonKeys.modify : jsonKeys.publish;
  const regexString = `(?:(?:'|"|\\b)(?:${arr.join(
    '|'
  )})(?:'|")?: ?(?:'|"))([a-zA-Z0-9_.\\-:+, /]*)(?:'|")`;

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
      dateArray = dateString.match(
        /(?:["'] ?: ?["'])([ :.a-zA-Z0-9_-]*)(?:["'])/
      );

      if (dateArray && dateArray[1]) {
        let date = getMomentObject(dateArray[1], url);
        if (date) return date;
      }
    }
  }

  // Try matching without global flag
  dateTest = new RegExp(regexString, 'i');
  dateArray = html.match(dateTest);

  if (dateArray && dateArray[1]) {
    let date = getMomentObject(dateArray[1], url);
    if (date) return date;
  }

  return null;
}

function checkURL(url) {
  const skipDomains = ['cnn.com/videos'];
  for (let domain of skipDomains) {
    if (url.includes(domain)) return null;
  }

  const dateTest =
    /([\./\-_]{0,1}(19|20)\d{2})[\./\-_]{0,1}(([0-3]{0,1}[0-9][\./\-_])|(\w{3,5}[\./\-_]))([0-3]{0,1}[0-9][\./\-]{0,1})/;
  let dateString = url.match(dateTest);

  if (dateString) {
    let date = getMomentObject(dateString[0], url);
    if (date) return date;
  }

  const singleDigitTest = /\/(\d{8})\//;
  dateString = url.match(singleDigitTest);

  if (dateString) {
    let date = getMomentObject(dateString[0], url);
    if (date) return date;
  }

  return null;
}

function getYoutubeDate(html) {
  if (!html) return null;

  const dateTest = new RegExp(
    `(?:["']ytInitialData[",']][.\\s\\S]*dateText["'].*)((?:${months.join(
      '|'
    )}) \\d{1,2}, \\d{4})(?:['"])`,
    'i'
  );
  const dateArray = html.match(dateTest);

  if (dateArray && dateArray[1]) {
    return getMomentObject(dateArray[1]);
  }

  // Parse videos where date is like "4 hours ago"
  const dateDifferenceTest =
    /(?:["']ytInitialData[",']][.\s\S]*dateText["'].*["'](?:\w+ )+) ?(\d+) ((?:second|minute|hour|day|month|year)s?) (?:ago)(?:['"])/i;
  const dateDifferenceArray = html.match(dateDifferenceTest);

  if (dateDifferenceArray && dateDifferenceArray.length >= 3) {
    return getDateFromRelativeTime(
      dateDifferenceArray[1],
      dateDifferenceArray[2]
    );
  }

  return null;
}

function checkLinkedData(article, url, checkModified, specificKey) {
  let linkedData = article.querySelectorAll(
    'script[type="application/ld+json"], script[type="application/json"]'
  );
  const arr = checkModified ? jsonKeys.modify : jsonKeys.publish;

  if (linkedData && linkedData.length) {
    // Some sites have more than one script tag with linked data
    for (let node of linkedData) {
      try {
        let data = JSON.parse(node.innerHTML);

        if (specificKey) {
          return getMomentObject(_.get(data, specificKey), url);
        }

        for (let key of arr) {
          if (data[key]) {
            let date = getMomentObject(data[key], url);
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

function checkMetaData(article, checkModified, url) {
  const arr = checkModified ? metaAttributes.modify : metaAttributes.publish;
  const metaData = article.querySelectorAll('meta');
  const metaRegex = new RegExp(arr.join('|'), 'i');

  for (let meta of metaData) {
    const property =
      meta.getAttribute('name') ||
      meta.getAttribute('property') ||
      meta.getAttribute('itemprop') ||
      meta.getAttribute('http-equiv');

    if (property && metaRegex.test(property)) {
      const date = getMomentObject(meta.getAttribute('content'), url);
      if (date) return date;
    }
  }

  return null;
}

function checkSelectors(article, html, site, checkModified, url) {
  const specificSelector =
    !checkModified && site
      ? typeof site === 'string'
        ? site
        : site.key
      : null;

  const arr = specificSelector
    ? [specificSelector]
    : checkModified
    ? selectors.modify.slice()
    : selectors.publish.slice();

  // Since we can't account for every possible selector a site will use,
  // we check the HTML for CSS classes or IDs that might contain the publish date
  if (!specificSelector) {
    const possibleClassStrings = ['byline'];

    if (checkModified) {
      possibleClassStrings.push(...['update', 'modify']);
    } else {
      possibleClassStrings.push('publish');
    }

    const classTest = new RegExp(
      `(?:(?:class|id)=")([ a-zA-Z0-9_-]*(${possibleClassStrings.join(
        '|'
      )})[ a-zA-Z0-9_-]*)(?:"?)`,
      'gim'
    );

    let classMatch;
    while ((classMatch = classTest.exec(html))) {
      if (!arr.includes(classMatch[1])) {
        arr.push(classMatch[1]);
      }
    }
  }

  for (let selector of arr) {
    const selectorString = specificSelector
      ? specificSelector
      : `[itemprop^="${selector}" i], [class^="${selector}" i], [id^="${selector}" i], input[name^="${selector}" i]`;
    const elements = article.querySelectorAll(selectorString);

    // Loop through elements to see if one is a date
    if (elements && elements.length) {
      for (let element of elements) {
        if (site && typeof site === 'object' && site.attribute) {
          log(`Specific Attribute: ${site.attribute}`);
          const value =
            site.attribute === 'innerText'
              ? innerText(element)
              : element.getAttribute(site.attribute);

          return getMomentObject(value, url, true);
        }

        const dateElement = element.querySelector('time') || element;
        const dateAttribute =
          dateElement.getAttribute('datetime') ||
          dateElement.getAttribute('content') ||
          dateElement.getAttribute('datePublished');

        if (dateAttribute) {
          const date = getMomentObject(dateAttribute, url);

          if (date) {
            return date;
          }
        }

        const dateString =
          innerText(dateElement) || dateElement.getAttribute('value');
        let date = getDateFromString(dateString, url);

        if (date) {
          log(`dateString: ${dateString}`);
          return date;
        }

        date = checkChildNodes(element, url);
        if (date) return date;
      }
    }
  }

  if (specificSelector) {
    return null;
  }

  // Check for time elements that might be publication date
  const timeSelectors = checkModified
    ? 'time[updatedate], time[modifydate], time[dt-updated]'
    : 'article time[datetime], time[pubdate]';

  const timeElements = article.querySelectorAll(timeSelectors);

  if (timeElements && timeElements.length) {
    for (let element of timeElements) {
      const attributes = checkModified
        ? ['updatedate', 'modifydate', 'dt-updated', 'datetime']
        : ['pubdate', 'datetime'];
      const dateString =
        attributes.map(a => element.getAttribute(a)).find(d => d) ||
        innerText(element);

      let date = getDateFromString(dateString, url);

      if (date) {
        log(`Time element dateString: ${dateString}`);
        return date;
      }

      date = checkChildNodes(element);
      if (date) return date;
    }
  }

  if (checkModified) {
    return null;
  }

  // If all else fails, try searching for very generic selectors.
  // We only use this date if there is only one occurance
  const genericSelectors = [
    '.date',
    '#date',
    '.byline',
    '.data',
    '.datetime',
    '.submitted'
  ];
  for (let selector of genericSelectors) {
    const elements = article.querySelectorAll(
      `article ${selector}, .article ${selector}, #article ${selector}, header ${selector}, ${selector}`
    );

    if (elements.length === 1) {
      let date = getDateFromString(innerText(elements[0]), url);
      if (date) return date;

      date = checkChildNodes(elements[0]);
      if (date) return date;
    }
  }

  return null;
}

function checkChildNodes(parent, url) {
  if (!parent.hasChildNodes()) return null;

  const children = parent.childNodes;

  for (let i = 0; i < children.length; i++) {
    const text = children[i].textContent.trim();
    const date = getDateFromString(text, url);

    if (date) {
      log(`Child node: ${text}`);
      return date;
    }
  }

  return null;
}

// When a date string is something like 1/2/20, we attempt
// to guess which number is the month and which is the day.
// We default parsing as <month>/<day>/<year>

export function getDateFromParts(nums = [], url) {
  if (!nums) {
    return null;
  }

  if (typeof nums === 'string') {
    nums = nums
      .replace(/[\n\r]+|[\s]{2,}/g, ' ')
      .trim()
      .replace(/[\.\/-]/g, '-')
      .split('-');
  }

  if (!Array.isArray(nums)) {
    return null;
  }

  if (nums.length > 1) {
    nums[0] = nums[0].replace(/\S*\s/g, '');
  }

  let day, month, year;
  let [num1, num2, num3] = nums;

  if (isNaN(parseInt(num1)) || isNaN(parseInt(num2))) return null;

  // Use tomorrow for dates to account for time zones
  const tomorrow = moment().add(1, 'd');
  const currentDay = tomorrow.date();
  const currentYear = tomorrow.year();
  const currentMonth = tomorrow.month() + 1;
  const prefer = {
    YMD: true,
    DMY: false,
    MDY: true
  };

  // If the URL uses a country specific TLD,
  // we use the countries preferred format
  if (url) {
    const domain = new URL(url).hostname.split('.').pop();
    if (tlds[domain]) Object.assign(prefer, tlds[domain]);
  }

  num1 = String(num1);
  num2 = String(num2);

  if (!isNaN(parseInt(num3))) {
    num3 = String(num3).replace(/(\d{2,4})\b.*/, '$1');

    if (num1.length === 4) {
      if (num3.length === 4) {
        return null;
      }

      day = parseInt(num3);
      month = parseInt(num2);
      year = parseInt(num1);
    } else {
      if (!num3.match(/^\d{2,4}$/)) {
        return null;
      }

      if (num3.length === 2) {
        num3 = String(currentYear).substr(0, 2) + num3;
      }

      day = prefer.MDY ? parseInt(num2) : parseInt(num1);
      month = prefer.MDY ? parseInt(num1) : parseInt(num2);
      year = parseInt(num3);
    }
  } else {
    day = prefer.MDY ? parseInt(num2) : parseInt(num1);
    month = prefer.MDY ? parseInt(num1) : parseInt(num2);
    num3 = String(currentYear);
    year = parseInt(num3);
  }

  // Month can't be greater than 12 or in the future
  if (month > 12 || month > currentMonth) {
    const _day = day;
    day = month;
    month = _day;
  }

  // Day cannot be in the future
  if (month === currentMonth && day > currentDay && year === currentYear) {
    if (month < currentDay && day <= currentMonth) {
      const _day = day;
      day = month;
      month = _day;
    }
  }

  if (day > 31 || month > 12 || year > currentYear) {
    return null;
  }

  if (day && month && year) {
    return `${month}-${day}-${year}`;
  }

  return null;
}

export function getDateFromString(string, url) {
  if (!string || !string.trim()) return null;
  string = string.trim();
  let date = getMomentObject(string, url);
  if (date) return date;

  string = string
    .replace(/\b\d{1,2}:\d{1,2}.*/, '')
    .replace(/([-\/]\d{2,4}) .*/, '$1')
    .trim();

  date = getMomentObject(string, url);
  if (date) return date;

  date = getMomentObject(getDateFromParts(string, url));
  if (date) return date;

  const numberDateTest = /^\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{1,4}$/;
  let dateString = string.match(numberDateTest);

  if (dateString) date = getMomentObject(dateString[0], url);
  if (date) return date;

  dateString = string.match(/(?:published):? (.*$)/i);
  if (dateString) date = getMomentObject(dateString[1], url);
  if (date) return date;

  const stringDateTest = new RegExp(
    `/(${months.join('|')})\w*\b \d{1,2},? {1,2}(\d{4}|\d{2})/i`,
    'i'
  );
  dateString = string.match(stringDateTest);
  if (dateString) date = getMomentObject(dateString[0], url);
  if (date) return date;

  dateString = string
    .replace(/at|on|,/g, '')
    .replace(/(\d{4}).*/, '$1')
    .replace(/([0-9]st|nd|th)/g, '')
    .replace(/posted:*/i, '')
    .replace(
      /.*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
      ''
    )
    .trim();

  date = getMomentObject(dateString, url);
  if (date) return date;

  return null;
}

////////////////////////////
// Helpers
////////////////////////////

function getMomentObject(dateString, url, ignoreLength) {
  if (!dateString) return null;
  if (!ignoreLength && dateString.length && dateString.length > 100) {
    return null;
  }

  let date = moment(dateString);
  if (isValid(date)) return date;

  // Check for multiple pieces of article metadata separated by the "|" character
  const parts = dateString.split('|');

  if (parts.length > 1) {
    for (const part of parts) {
      date = getMomentObject(part, url, ignoreLength);
      if (isValid(date)) return date;
    }
  }

  dateString = dateString
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/^.*(from|original|published|modified)[^ ]*/i, '')
    .trim();

  // Try to account for strangly formatted dates
  const timezones = ['est', 'cst', 'mst', 'pst', 'edt', 'cdt', 'mdt', 'pdt'];

  for (let timezone of timezones) {
    if (dateString.toLowerCase().includes(timezone)) {
      date = moment(dateString.substring(0, dateString.indexOf(timezone)));
      if (isValid(date)) return date;
    }
  }

  const monthsJoined = months.join('|');
  const dateSearch = new RegExp(
    `((((${monthsJoined})\.?\s+\d{1,2})|(\d{1,2}\s+(${monthsJoined})\.?)),?\s+\d{2,4}\b)`,
    'i'
  );
  const matchedDate = dateString.match(dateSearch);

  if (matchedDate) {
    date = moment(matchedDate[0]);
    if (isValid(date)) return date;
  }

  for (let month of months) {
    if (dateString.toLowerCase().includes(month)) {
      const monthSearch = new RegExp(`(\\d{1,4} )?${month}`, 'i');
      const startIndex = dateString.search(monthSearch);
      const yearIndex = dateString.search(/\d{4}/);
      const endIndex = yearIndex === -1 ? dateString.length : yearIndex + 4;

      date = moment(dateString.substring(startIndex, endIndex));
      if (isValid(date)) return date;
    }
  }

  // Some invalid date strings include the date without formatting
  let digitDate = dateString.replace(/[ \.\/-]/g, '');
  const dateNumbers = parseDigitOnlyDate(digitDate, url);

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

function parseDigitOnlyDate(dateString, url) {
  if (!dateString) return null;

  let matchedDate = dateString
    .replace(/\/|-\./g, '')
    .match(/\b(\d{6}|\d{8})\b/);

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
    const dateArray = dateString
      .replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3')
      .split('-');

    const date = getDateFromParts(dateArray, url);
    if (date && isValid(date)) return date;
  } else {
    let date = getDateFromParts(
      dateString.replace(/(\d{2})(\d{2})(\d{4})/, '$1-$2-$3'),
      url
    );

    if (date && isValid(date)) return date;

    date = getDateFromParts(
      dateString.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      url
    );

    if (date && isValid(date)) return date;
  }

  return null;
}

function isValid(date) {
  if (!moment.isMoment(date)) date = moment(date);
  const input = date._i;
  if (!input) return false;

  if (date.isBefore(moment().subtract(10, 'y')) && !input.match(/\b\d{4}\b/)) {
    const year = new Date().getFullYear();
    date.year(year);
  }

  if (!date.isValid()) {
    return false;
  }

  // Check if the date is on or before tomorrow to account for time zone differences
  const tomorrow = moment().add(1, 'd');

  // There are a lot of false positives that return
  // January 1st of the current year. To avoid frequent
  // incorrect dates, we typically assume that a Jan 1
  // date is invalid unless the current month is January
  const jan1 = moment(`${new Date().getFullYear()}-01-01`);

  if (tomorrow.month() !== 0 && date.isSame(jan1, 'd')) {
    return false;
  }

  const longAgo = moment().subtract(19, 'y');
  const inputLength = date._i.length;
  const digits = date._i.match(/\d/g);
  const digitLength = !digits ? 0 : digits.length;

  return (
    date.isSameOrBefore(tomorrow, 'd') &&
    date.isSameOrAfter(longAgo) &&
    inputLength >= 5 &&
    digitLength >= 3
  );
}

function isRecent(date, difference = 31, url) {
  if (!date) return false;
  if (!moment.isMoment(date)) date = getMomentObject(date, url);

  const tomorrow = moment().add(1, 'd');
  const lastMonth = tomorrow.clone().subtract(difference, 'd');

  return date.isValid() && date.isBetween(lastMonth, tomorrow, 'd', '[]');
}

function fetchArticleAndParse(url, checkModified, shouldSetUserAgent) {
  return new Promise((resolve, reject) => {
    getArticleHtml(url, shouldSetUserAgent)
      .then(html => {
        if (!html) reject('Error fetching HTML');

        const { date: publishDate, dom } = getDateFromHTML(html, url);

        const data = {
          publishDate,
          modifyDate:
            publishDate && checkModified
              ? getDateFromHTML(html, url, true, dom).date
              : null
        };

        // Ensure JSDOM object is destroyed
        if (dom && dom.window) {
          dom.window.close();
        }

        // Avoid memory leaks from RegExp.lastMatch
        freeRegExp();

        if (data.publishDate) {
          resolve(data);
        } else {
          reject(`No date found: ${url}`);
        }
      })
      .catch(reject);
  });
}

// Find the publish date from a passed URL
export default function getPublishDate(url, checkModified) {
  if (url && url.trim().match(/\.pdf($|\?)/)) {
    return Promise.reject('URL refers to a PDF');
  }

  return new Promise((resolve, reject) => {
    try {
      fetchArticleAndParse(url, checkModified)
        .then(resolve)
        .catch(() => {
          // If the first fetch fails try requesting with a user agent
          // agent set. Somtimes websites return different HTML
          // based on the user agent making the request
          fetchArticleAndParse(url, checkModified, true)
            .then(data => resolve(data))
            .catch(error => {
              // Limit the length of error message to prevent memory overflow
              const maxErrorLength = 500;

              if (typeof error === 'string') {
                error = error.substring(0, maxErrorLength);
              } else if (error.message) {
                error = error.message.substring(0, maxErrorLength);
              }

              reject(error);
            });
        });
    } catch (error) {
      reject(error);
    }
  });
}

export { getPublishDate };

// JSDOM does not include HTMLElement.innerText
function innerText(el) {
  el = el.cloneNode(true);
  el.querySelectorAll('script, style').forEach(s => s.remove());
  return el.textContent
    .replace(/\n\s*\n/g, '\n')
    .replace(/  +/g, '')
    .trim();
}

if (process.argv[2]) {
  shouldLogDateMethod = true;
  const checkModified = process.argv[3] !== 'false';

  getPublishDate(process.argv[2], checkModified)
    .then(({ publishDate, modifyDate }) => {
      publishDate = publishDate ? publishDate.format('YYYY-MM-DD') : null;
      modifyDate = modifyDate ? modifyDate.format('YYYY-MM-DD') : null;
      console.log({ publishDate, modifyDate, method: searchMethod });
    })
    .catch(e => {
      console.log(`Error: ${e}`);
    });
} else {
  shouldLogDateMethod = false;
}
