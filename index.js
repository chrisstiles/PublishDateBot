const getPublishDate = require('./get-publish-date');

const url = process.argv[2];
getPublishDate(url);