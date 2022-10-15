import DateParser from './DateParser.js';
import { hrtime } from 'node:process';
import jsdom from 'jsdom';
import moment from 'moment';
import Promise from 'bluebird';
import cache from 'memory-cache';
import _ from 'lodash';
import { log as writeLog, fetchTimeout, freeRegExp, innerText, ApiError, DateNotFoundError, getError } from './util.js'; // prettier-ignore
import { htmlOnlyDomains, jsonKeys, metaAttributes, months, selectors, sites, tlds } from './data/index.js'; // prettier-ignore

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(StealthPlugin());
puppeteer.use(
  AdblockerPlugin({
    blockTrackers: true,
    interceptResolutionPriority: puppeteer.DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
  })
);

// async function getHtmlWithPuppeteer(url) {
//   const browser = await puppeteer.launch({ headless: true });
//   const page = await browser.newPage();

//   await page.setRequestInterception(true);

//   page.on('request', request => {
//     const blockedTypes = ['image', 'stylesheet', 'font', 'media'];

//     if (blockedTypes.includes(request.resourceType())) {
//       request._interceptionHandled = false;
//       request.abort();
//     } else if (request._interceptionHandled) {
//       return;
//     } else {
//       request.continue();
//     }
//   });

//   await page.goto(url, { waitUntil: 'domcontentloaded' });
//   const html = await page.content();

//   await browser.close();
//   return html;
// }

const { JSDOM } = jsdom;
// const cacheDuration = 1000 * 60 * 10; // 10 minutes
// const maxCacheItems = 1000;
const dateLocations = {
  ELEMENT: 'HTML Element',
  ATTRIBUTE: 'HTML Attribute',
  STRING: 'HTML String',
  URL: 'Article URL',
  DATA: 'Structured Data',
  META: 'Meta Tag'
};

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

export function getDateFromHTML(html, url, checkModified, dom) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
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

  // Article data
  const data = { date: null, dom, ...getArticleMetadata(article, url) };

  // We can add site specific methods for finding publish
  // dates. This is helpful for websites with incorrect
  // or inconsistent ways of displaying publish dates
  const urlObject = new URL(url);
  const hostname = urlObject.hostname.replace(/^www./, '');
  const site = sites[hostname];

  if (site && !checkModified) {
    // String values refer to selectors
    if (typeof site === 'string') {
      data.date = checkSelectors(article, html, site, false, url);
      return data;
    }

    if (
      typeof site === 'object' &&
      (site.key || site.method === 'linkedData')
    ) {
      // Some websites have different layouts for different
      // sections of the website (i.e. /video/).
      const { path, key, method = 'selector' } = site;

      // If URL is on the same site, but a different path we
      // will continue checking the data normally.
      if (
        method &&
        (!path || urlObject.pathname.match(new RegExp(path, 'i')))
      ) {
        switch (method) {
          case 'html':
            data.date = checkHTMLString(html, url, false, key);
            break;
          case 'selector':
            data.date = checkSelectors(article, html, site, false, url);
            break;
          case 'linkedData':
            data.date = checkLinkedData(article, html, false, key);
            break;
        }
      }
    }

    if (data.date) return data;
  }

  // Some domains have incorrect dates in their
  // URLs or LD JSON. For those we only
  // check the page's markup for the date
  let isHTMLOnly = false;

  if (htmlOnlyDomains && htmlOnlyDomains.length) {
    for (let domain of htmlOnlyDomains) {
      if (hostname.includes(domain)) {
        isHTMLOnly = true;
        break;
      }
    }
  }

  // Try searching from just the HTML string with regex
  // We just look for JSON as it is not accurate to parse
  // HTML with regex, but is much faster than using the DOM
  if (!isHTMLOnly) {
    data.date = checkHTMLString(html, url, checkModified);
    if (data.date) return data;
  }

  // Attempt to get date from URL, we do this after
  // checking the HTML string because it can be inaccurate
  let urlDate = null;

  if (!isHTMLOnly && !checkModified) {
    urlDate = checkURL(url);

    if (urlDate && isRecent(urlDate, 3, url)) {
      data.date = urlDate;
      return data;
    }
  }

  // Some websites include linked data with information about the article
  data.date = checkLinkedData(article, url, checkModified);
  if (data.date) return data;

  // Next try searching <meta> tags
  data.date = checkMetaData(article, checkModified, url);
  if (data.date) return data;

  // Try checking item props and CSS selectors
  data.date = checkSelectors(article, html, null, checkModified, url);
  if (data.date) return data;

  // Use URL date if other parsing methods failed
  if (urlDate) data.date = urlDate;

  return data;
}

function checkHTMLString(html, url, checkModified, key) {
  if (!html) return null;

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
        let date = getMomentObject(dateArray[1], url, dateLocations.STRING);

        if (date) {
          date.html = dateString;
          return date;
        }
      }
    }
  }

  // Try matching without global flag
  dateTest = new RegExp(regexString, 'i');
  dateArray = html.match(dateTest);

  if (dateArray && dateArray[1]) {
    let date = getMomentObject(dateArray[1], url, dateLocations.STRING);

    if (date) {
      date.html = dateArray[1];
      return date;
    }
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
    let date = getMomentObject(dateString[0], url, dateLocations.URL);

    if (date) {
      date.html = url;
      return date;
    }
  }

  const singleDigitTest = /\/(\d{8})\//;
  dateString = url.match(singleDigitTest);

  if (dateString) {
    let date = getMomentObject(dateString[0], url, dateLocations.URL);

    if (date) {
      date.html = url;
      return date;
    }
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
    return getMomentObject(dateArray[1], null, dateLocations.STRING);
  }

  // Parse videos where date is like "4 hours ago"
  const dateDifferenceTest =
    /(?:["']ytInitialData[",']][.\s\S]*dateText["'].*["'](?:\w+ )+) ?(\d+) ((?:second|minute|hour|day|month|year)s?) (?:ago)(?:['"])/i;
  const dateDifferenceArray = html.match(dateDifferenceTest);

  if (dateDifferenceArray && dateDifferenceArray.length >= 3) {
    const date = getDateFromRelativeTime(
      dateDifferenceArray[1],
      dateDifferenceArray[2]
    );

    if (date) {
      date.location = dateLocations.STRING;
    }
  }

  return null;
}

function checkLinkedData(article, url, checkModified, specificKey) {
  const linkedData = getLinkedData(article);
  const arr = checkModified ? jsonKeys.modify : jsonKeys.publish;

  if (linkedData?.length) {
    for (const data of linkedData) {
      if (typeof data === 'object') {
        if (specificKey) {
          const dateString = _.get(data, specificKey);
          const date = getMomentObject(dateString, url, dateLocations.DATA);

          if (date) {
            date.html = formatDateJson(specificKey, dateString, date);
            return date;
          }
        }

        for (let key of arr) {
          if (data[key]) {
            const date = getMomentObject(data[key], url, dateLocations.DATA);

            if (date) {
              date.html = formatDateJson(key, data[key], date);
              return date;
            }
          }
        }
      } else if (typeof data === 'string') {
        // The website has invalid JSON, attempt
        // to get the date with Regex
        const date = checkHTMLString(data, url, checkModified);
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
  const attributes = ['name', 'property', 'itemprop', 'http-equiv'];

  for (let meta of metaData) {
    const attributeName = attributes.find(a => meta.getAttribute(a));
    const attribute = meta.getAttribute(attributeName);

    if (attribute && metaRegex.test(attribute)) {
      const date = getMomentObject(
        meta.getAttribute('content'),
        url,
        dateLocations.META
      );

      if (date) {
        // Clean up outputted HTML by omitting extra attributes
        meta.getAttributeNames().forEach(attribute => {
          if (attribute !== attributeName && attribute !== 'content') {
            meta.removeAttribute(attribute);
          }
        });

        date.html = meta.outerHTML;
        return date;
      }
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
          const isInnerText = site.attribute === 'innerText';

          const value = isInnerText
            ? textContent(element)
            : element.getAttribute(site.attribute);

          const location = isInnerText
            ? dateLocations.ELEMENT
            : dateLocations.ATTRIBUTE;

          const date = getMomentObject(value, url, location, true);

          if (date) {
            date.html = element.outerHTML;
          }

          return date;
        }

        const dateElement = element.querySelector('time') || element;
        const dateAttribute =
          dateElement.getAttribute('datetime') ||
          dateElement.getAttribute('content') ||
          dateElement.getAttribute('datePublished');

        if (dateAttribute) {
          const date = getMomentObject(
            dateAttribute,
            url,
            dateLocations.ATTRIBUTE
          );

          if (date) {
            date.html = dateElement.outerHTML;
            return date;
          }
        }

        const textContent = innerText(dateElement);
        const valueAttribute = dateElement.getAttribute('value');
        const dateString = textContent || valueAttribute;
        const location = textContent
          ? dateLocations.ELEMENT
          : dateLocations.ATTRIBUTE;

        let date = getDateFromString(dateString, url, location);

        if (date) {
          log(`dateString: ${dateString}`);
          date.html = dateElement.outerHTML;
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

      const dateAttribute = attributes
        .map(a => element.getAttribute(a))
        .find(d => d);
      const dateString = dateAttribute || innerText(element);
      const location = dateAttribute
        ? dateLocations.ATTRIBUTE
        : dateLocations.ELEMENT;

      let date = getDateFromString(dateString, url, location);

      if (date) {
        log(`Time element dateString: ${dateString}`);
        date.html = element.outerHTML;
        return date;
      }

      date = checkChildNodes(element, url);
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
      let date = getDateFromString(
        innerText(elements[0]),
        url,
        dateLocations.ELEMENT
      );

      if (date) {
        date.html = elements[0].outerHTML;
        return date;
      }

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
    const date = getDateFromString(text, url, dateLocations.ELEMENT);

    if (date) {
      log(`Child node: ${text}`);
      date.html = children[i].outerHTML;
      return date;
    }
  }

  return null;
}

// When a date string is something like 1/2/20, we attempt
// to guess which number is the month and which is the day.
// We default parsing as <month>/<day>/<year>
export function getDateFromParts(nums = [], url) {
  if (!nums) return null;

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

export function getDateFromString(string, url, location) {
  if (!string || !string.trim()) return null;
  string = string.trim();
  let date = getMomentObject(string, url, location);
  if (date) return date;

  string = string
    .replace(/\b\d{1,2}:\d{1,2}.*/, '')
    .replace(/([-\/]\d{2,4}) .*/, '$1')
    .trim();

  date = getMomentObject(string, url, location);
  if (date) return date;

  date = getMomentObject(getDateFromParts(string, url), url, location);
  if (date) return date;

  const numberDateTest = /^\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{1,4}$/;
  let dateString = string.match(numberDateTest);

  if (dateString) date = getMomentObject(dateString[0], url, location);
  if (date) return date;

  dateString = string.match(/(?:published):? (.*$)/i);
  if (dateString) date = getMomentObject(dateString[1], url);
  if (date) return date;

  const stringDateTest = new RegExp(
    `/(${months.join('|')})\w*\b \d{1,2},? {1,2}(\d{4}|\d{2})/i`,
    'i'
  );
  dateString = string.match(stringDateTest);
  if (dateString) date = getMomentObject(dateString[0], url, location);
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

  date = getMomentObject(dateString, url, location);
  if (date) return date;

  return null;
}

// async function fetchArticleHtml(url) {
//   const options = {
//     method: 'GET',
//     // prettier-ignore
//     headers: {
//       'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
//       'accept-language': 'en-US,en;q=0.9,it;q=0.8,es;q=0.7',
//       'cache-control': 'max-age=0'
//     },
//     compress: true,
//     insecureHTTPParser: true,
//     highWaterMark: 1024 * 1024
//   };

//   const response = await fetchTimeout(url, 30000, options);
//   return await response.text();
// }

// function fetchArticleAndParse(url, checkModified, shouldSetUserAgent) {
//   return new Promise((resolve, reject) => {
//     getArticleHtml(url, shouldSetUserAgent)
//       .then(html => {
//         if (!html) return reject('Error fetching HTML');

//         const article = getDateFromHTML(html, url);
//         const {
//           date = null,
//           organization = null,
//           title = null,
//           description = null,
//           dom
//         } = article;
//         const location = date?.location?.trim() ?? null;

//         let dateHtml = date?.html?.trim() ?? null;

//         if (!date?.hasFormattedJson && dateHtml?.match(/"[^"]+": ?"[^"]+"/)) {
//           dateHtml = formatDateJson(dateHtml);
//         }

//         const data = {
//           organization,
//           title,
//           description,
//           location,
//           html: dateHtml,
//           publishDate: date,
//           modifyDate:
//             date && checkModified
//               ? getDateFromHTML(html, url, true, dom).date
//               : null
//         };

//         // Ensure JSDOM object is destroyed
//         if (dom && dom.window) {
//           dom.window.close();
//         }

//         // Avoid memory leaks from RegExp.lastMatch
//         freeRegExp();

//         if (data.publishDate) {
//           resolve(data);
//         } else {
//           reject(
//             new DateNotFoundError(url, { organization, title, description })
//           );
//         }
//       })
//       .catch(reject);
//   });
// }

////////////////////////////
// Helpers
////////////////////////////

function getMomentObject(
  dateString,
  url,
  location = null,
  ignoreLength = false
) {
  if (!dateString) return null;
  if (!ignoreLength && dateString.length && dateString.length > 100) {
    return null;
  }

  const addMetaData = date => {
    date.location = location;
    return date;
  };

  let date = moment(dateString);

  if (isValid(date)) {
    return addMetaData(date);
  }

  // Check for multiple pieces of article metadata separated by the "|" character
  const parts = dateString.split('|');

  if (parts.length > 1) {
    for (const part of parts) {
      date = getMomentObject(part, url, location, ignoreLength);

      if (isValid(date)) {
        return addMetaData(date);
      }
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

      if (isValid(date)) {
        return addMetaData(date);
      }
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

    if (isValid(date)) {
      return addMetaData(date);
    }
  }

  for (let month of months) {
    if (dateString.toLowerCase().includes(month)) {
      const monthSearch = new RegExp(`(\\d{1,4} )?${month}`, 'i');
      const startIndex = dateString.search(monthSearch);
      const yearIndex = dateString.search(/\d{4}/);
      const endIndex = yearIndex === -1 ? dateString.length : yearIndex + 4;

      date = moment(dateString.substring(startIndex, endIndex));

      if (isValid(date)) {
        return addMetaData(date);
      }
    }
  }

  // Some invalid date strings include the date without formatting
  let digitDate = dateString.replace(/[ \.\/-]/g, '');
  const dateNumbers = parseDigitOnlyDate(digitDate, url);

  if (dateNumbers) {
    date = moment(dateNumbers);

    if (isValid(date)) {
      return addMetaData(date);
    }
  }

  // Use today's date if the string contains 'today'
  if (dateString.includes('today')) {
    return addMetaData(moment());
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

function formatDateJson(key, value, date) {
  key = key?.trim();
  value = value?.trim();

  if (!key) return null;
  if (date) date.hasFormattedJson = true;

  return (value ? `{ "${key}": "${value}" }` : `{ ${key} }`)
    .replace(/^{[^"]+/g, '{ ')
    .replace(/([^"])+}$/g, '$1 }')
    .replace(/":([^ ])/g, '": $1')
    .replace(/ {2,}/g, ' ');
}

function getLinkedData(article) {
  const nodes = article.querySelectorAll(
    'script[type="application/ld+json"], script[type="application/json"]'
  );

  return Array.from(nodes)
    .map(node => {
      const content = node.textContent;

      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    })
    .flat();
}

function getArticleMetadata(article, url) {
  let organization = null;
  let title = null;
  let description = null;

  const linkedData = getLinkedData(article);

  // Start by searching for structured data as it is the most reliable
  if (linkedData?.length) {
    const get = (...args) => {
      return args.find(a => a && typeof a === 'string') ?? null;
    };

    for (const data of linkedData) {
      if (typeof data === 'object') {
        organization ??= get(data.publisher?.name, data.name);
        title ??= get(data.headline);
        description ??= get(data.description);
      }

      if (organization && title && description) break;
    }
  }

  // Fallbacks if values were not found in linked data
  organization ??= (
    article.querySelector('meta[property="og:site_name"]')?.content ??
    article.querySelector('meta[property="twitter:title"]')?.content ??
    article.querySelector('meta[name="application-name"]')?.content ??
    new URL(url).hostname ??
    null
  )?.trim();

  title ??=
    article.querySelector('meta[property="og:title"]')?.content ??
    article.querySelector('meta[property="twitter:title"]')?.content ??
    innerText(article.querySelector('article h1')) ??
    article.title?.replace(/ ?[-|][^-|]+$/, '') ??
    null;

  if (organization && title && organization !== title) {
    const regex = new RegExp(`^${organization} [-|]|[-|] ${organization}$`);
    title = title.replace(regex, '').trim();
  }

  description ??=
    article.querySelector('meta[property="og:description"]')?.content ??
    article.querySelector('meta[property="twitter:description"]')?.content ??
    article.querySelector('meta[name="description"]')?.content ??
    null;

  return {
    organization: organization?.trim(),
    title: title?.trim(),
    description: description?.trim()
  };
}

////////////////////////////
// Date Parsing
////////////////////////////

export default async function getPublishDate(url, checkModified, html) {
  html ||= await getArticleHtml(url);
  if (!html) throw new Error('Invalid HTML', url);

  const {
    date: publishDate = null,
    organization = null,
    title = null,
    description = null,
    dom
  } = getDateFromHTML(html, url);

  const location = publishDate?.location?.trim() ?? null;
  const modifyDate =
    publishDate && checkModified
      ? getDateFromHTML(html, url, true, dom).date
      : null;

  let dateHtml = publishDate?.html?.trim() ?? null;

  if (!publishDate?.hasFormattedJson && dateHtml?.match(/"[^"]+": ?"[^"]+"/)) {
    dateHtml = formatDateJson(dateHtml);
  }

  const data = {
    publishDate,
    modifyDate,
    organization,
    title,
    description,
    location,
    html: dateHtml
  };

  // Ensure JSDOM object is destroyed
  if (dom && dom.window) {
    dom.window.close();
  }

  // Avoid memory leaks from RegExp.lastMatch
  freeRegExp();

  if (!data.publishDate) {
    throw new DateNotFoundError(url, { organization, title, description });
  }

  return data;
}

export { getPublishDate };

async function getArticleHtml(url, shouldAddAdditionalHeaders) {
  const options = {
    method: 'GET',
    // prettier-ignore
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,it;q=0.8,es;q=0.7',
      'cache-control': 'max-age=0'
    },
    compress: true,
    insecureHTTPParser: true,
    highWaterMark: 1024 * 1024
  };

  if (shouldAddAdditionalHeaders) {
    options.headers['referrer'] = new URL(url).origin;
    options.headers['user-agent'] =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36';
  }

  try {
    const response = await fetchTimeout(url, 30000, options);

    if (response.status === 200) return await response.text();
    if (!shouldAddAdditionalHeaders) return await getArticleHtml(url, true);

    throw new Error(`Status code: ${response.status}, URL: ${url}`);
  } catch (error) {
    if (!shouldAddAdditionalHeaders) return await getArticleHtml(url, true);
    throw error;
  }
  // return new Promise((resolve, reject) => {

  //   fetchTimeout(url, 30000, options)
  //     .then(async response => {
  //       if (response.status === 200) {
  //         return resolve(await response.text());
  //       }

  //       reject(`status code ${response.status}, URL: ${url}`);
  //     })
  //     .catch(error => reject(`${error}, ${url}`));
  // });
}

// Find the publish date from a passed URL
// export function getPublishDateOld(url, checkModified) {
//   if (url && url.trim().match(/\.pdf($|\?)/)) {
//     return Promise.reject('URL refers to a PDF');
//   }

//   const cachedValue = cache.get(url);

//   if (cache.size() >= maxCacheItems) {
//     cache
//       .keys()
//       .slice(0, Math.floor(maxCacheItems / 2))
//       .forEach(key => {
//         cache.del(key);
//       });
//   }

//   if (cachedValue) {
//     return cachedValue instanceof ApiError
//       ? Promise.reject(cachedValue)
//       : Promise.resolve(cachedValue);
//   }

//   return new Promise((resolve, reject) => {
//     const handleSuccess = data => {
//       cache.put(url, data, cacheDuration);
//       return resolve(data);
//     };

//     const handleError = error => {
//       const apiError = getError(error, url);
//       cache.put(url, apiError, cacheDuration);
//       return reject(apiError);
//     };

//     try {
//       fetchArticleAndParse(url, checkModified)
//         .then(handleSuccess)
//         .catch(() => {
//           // If the first fetch fails, try requesting with additional
//           // headers set. Sometimes websites return different HTML
//           // based on the user agent or other headers making the request
//           fetchArticleAndParse(url, checkModified, true)
//             .then(handleSuccess)
//             .catch(handleError);
//         });
//     } catch (error) {
//       return handleError(error);
//     }
//   });
// }

if (process.argv[2]) {
  const start = hrtime.bigint();
  const checkModified = process.argv[3] !== 'false';
  shouldLogDateMethod = true;

  (async () => {
    const parser = new DateParser();

    try {
      // await parser.launch();

      // Get HTML with puppeteer
      // const data = await parser.get(process.argv[2], checkModified);

      // Get HTML with fetch
      const data = await getPublishDate(process.argv[2], checkModified);
      const end = hrtime.bigint();
      const duration = Number(end - start) / 1e9;

      data.publishDate = data.publishDate?.format('YYYY-MM-DD') ?? null;
      data.modifyDate = data.modifyDate?.format('YYYY-MM-DD') ?? null;

      console.log(`Finished in ${duration} seconds`);
      console.log(data);

      parser.close(true);
    } catch (error) {
      console.error(error);
      parser.close(true);
    }
    // await getHtmlWithPuppeteer(process.argv[2], checkModified);

    // console.log(`Puppeteer finished in ${duration} seconds`);
  })();

  // (async () => {
  //   await getHtmlWithFetch(process.argv[2], checkModified);
  //   const end = hrtime.bigint();
  //   const duration = Number(end - start) / 1e9;
  //   console.log(`Fetch finished in ${duration} seconds`);
  // })();

  // getPublishDate(process.argv[2], checkModified)
  //   .then(({ publishDate, modifyDate, location }) => {
  //     publishDate = publishDate ? publishDate.format('YYYY-MM-DD') : null;
  //     modifyDate = modifyDate ? modifyDate.format('YYYY-MM-DD') : null;

  //     const end = hrtime.bigint();
  //     const duration = Number(end - start) / 1e9;
  //     console.log({
  //       publishDate,
  //       modifyDate,
  //       method: location,
  //       duration: `${duration} seconds`
  //     });
  //     cache.clear();
  //   })
  //   .catch(e => {
  //     console.log(`Error: ${e}`);
  //     cache.clear();
  //   });
} else {
  shouldLogDateMethod = false;
}
