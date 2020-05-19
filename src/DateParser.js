const { Article } = require('./Article');
const puppeteer = require('puppeteer-extra');
// puppeteer.use(require('puppeteer-extra-plugin-stealth')());
// puppeteer.use(require('puppeteer-extra-plugin-adblocker')());
// puppeteer.use(
//   require('puppeteer-extra-plugin-block-resources')({
//     blockedTypes: new Set(['image', 'stylesheet', 'font', 'media'])
//   })
// );
// puppeteer.use(
//   require('puppeteer-extra-plugin-block-resources')({
//     blockedTypes: new Set(['image', 'stylesheet', 'font', 'media'])
//   })
// );
puppeteer.use(require('puppeteer-extra-plugin-adblocker')());
puppeteer.use(require('puppeteer-extra-plugin-stealth')());

// const devtools = require('puppeteer-extra-plugin-devtools')();
// puppeteer.use(devtools);

class DateParser {
  constructor() {
    this.method = null;
    // this.url = encodeURI(url);
    // this.checkModified = checkModified;
  }

  async launch() {
    this.browser = await puppeteer.launch({
      headless: true
    });

    // console.log(devtools.getLocalDevToolsUrl(this.browser));

    // const tunnel = devtools.createTunnel(this.browser);
    // console.log(tunnel.url)
    return this;
  }

  async getDate(url) {
    const page = await this.browser.newPage();

    // Prevent loading unnecessary resources
    await page.setRequestInterception(true);

    page.on('request', request => {
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

    const response = await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle0']
    });

    // const response = await page.goto(this.url);

    console.log(await response.status());
    // console.log(response.request().redirectChain());

    const article = new Article(url, this.browser);
    article.getDate();

    // console.log(await page.content());
    // return await page.evaluate(() => document.documentElement.outerHTML);
    return await page.content();
  }

  close() {
    console.log('Closing');
    this.browser.close();
  }

  fetchArticleAndParse() {
    console.log(this.url);
  }
}

module.exports = DateParser;
