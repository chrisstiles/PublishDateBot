// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

import { createRequire } from 'module';
const get = createRequire(import.meta.url);

// const data = {
//   htmlOnly: require('./htmlOnly.json'),
//   ignore: require('./ignore.json'),
//   jsonKeys: require('./jsonKeys.json'),
//   metaAttributes: require('./metaAttributes.json'),
//   months: require('./months.json'),
//   selectors: require('./selectors.json'),
//   sites: require('./sites.json'),
//   tlds: require('./tlds.json')
// };

export const htmlOnlyDomains = get('./htmlOnly.json');
export const ignoreDomains = get('./ignore.json');
export const jsonKeys = get('./jsonKeys.json');
export const metaAttributes = get('./metaAttributes.json');
export const months = get('./months.json');
export const selectors = get('./selectors.json');
export const sites = get('./sites.json');
export const tlds = get('./tlds.json');

export default {
  htmlOnlyDomains,
  ignoreDomains,
  jsonKeys,
  metaAttributes,
  months,
  selectors,
  sites,
  tlds
};
