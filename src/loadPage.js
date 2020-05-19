const { scrapers } = require('./Article');

// Article.prototype.test = function () {
//   console.log('Hello');
//   console.log(this.url.href);
// };

let prevScraper = null;

module.exports = async function () {
  // Articles can be loaded using either puppeteer
  // or node-fetch. This can be configured in sites.json
  // if (!this.scraper) {
  //   this.scraper =
  //     this.config.scraper === scrapers.FETCH
  //       ? scrapers.FETCH
  //       : scrapers.PUPPETEER;
  // }

  if (this.page && this.scraper === prevScraper) {
    return;
  }

  if (this.usePuppeteer && this.shouldCheck[scrapers.PUPPETEER]) {
    this.shouldCheck[scrapers.PUPPETEER] = false;

    this.page = await this.browser.newPage();
    await this.page.setRequestInterception(true);

    this.page.on('request', request => {
      const blockedTypes = ['image', 'stylesheet', 'font', 'media'];

      if (blockedTypes.includes(request.resourceType())) {
        request._interceptionHandled = false;
        request.abort();
      } else if (request._interceptionHandled) {
        return;
      } else {
        request.continue();
      }
    });

    const response = await this.page.goto(this.url.href, {
      waitUntil: ['domcontentloaded', 'networkidle0']
    });
  } else if (!this.usePuppeteer && this.shouldCheck[scrapers.FETCH]) {
    this.shouldCheck[scrapers.FETCH] = false;
  }

  prevScraper = this.scraper;
};
