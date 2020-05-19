const sites = require('./data/sites.json');

class Article {
  constructor(url, browser) {
    this.url = url;
    this.browser = browser;
    this.useFetch = false;
    this.shouldCheck = {
      [scrapers.PUPPETEER]: true,
      [scrapers.FETCH]: true
    };

    try {
      this.url = new URL(url);
      this.config = sites[this.url.hostname.replace(/^www./, '')] || {};

      if (typeof this.config === 'string') {
        this.config = {
          key: this.config,
          method: 'selector'
        };
      } else if (this.config.key && !this.config.method) {
        this.config.method = 'selector';
      }

      // If a site is configured to use a specific method of
      // scraping, prevent the other method from being tried
      if (this.config.scraper) {
        const other =
          this.config.scraper === scrapers.FETCH
            ? scrapers.PUPPETEER
            : scrapers.FETCH;
        this.shouldCheck[other] = false;
      }

      console.log(this.shouldCheck);
    } catch (error) {
      throw new Error(error);
    }
  }

  get usePuppeteer() {
    if (!this.scraper) {
      this.scraper =
        this.config.scraper === scrapers.FETCH
          ? scrapers.FETCH
          : scrapers.PUPPETEER;
    }

    return this.scraper === scrapers.PUPPETEER;
  }

  set usePuppeteer(value) {
    this.scraper = value ? scrapers.PUPPETEER : scrapers.FETCH;
  }

  async getDate() {
    // console.log(this.url);
    await this.loadPage();
  }
}

const scrapers = {
  FETCH: 'fetch',
  PUPPETEER: 'puppeteer'
};

module.exports = { Article, scrapers };

Article.prototype.loadPage = require('./loadPage');

// require('./test').default;
