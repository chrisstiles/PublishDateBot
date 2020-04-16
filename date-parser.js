const puppeteer = require('puppeteer');

class DateParser {
  constructor(url, checkModified) {
    this.method = null;
    this.url = encodeURI(url);
    this.checkModified = checkModified;
  }

  async launch() {
    this.browser = await puppeteer.launch();
    return this;
  }

  async getDate() {
    // const browser = await puppeteer.launch();
    const page = await this.browser.newPage();
    await page.goto(this.url);
    // console.log(page);
    let bodyHTML = await page.evaluate(() => document.documentElement.outerHTML);
    return bodyHTML;
    // console.log(bodyHTML)
    // return new Promise((resolve, reject) => {

    // });
    // this.fetchArticleAndParse();
    // browser.close();
  }

  close() {
    this.browser.close();
  }

  fetchArticleAndParse() {
    console.log(this.url);
  }
}

module.exports = DateParser;