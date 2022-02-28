import { createRequire } from 'module';
const get = createRequire(import.meta.url);

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
