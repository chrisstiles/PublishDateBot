///////////////////////
// Used for testing URLs 
///////////////////////

const getPublishDate = require('./get-publish-date');
const moment = require('moment');
const url = process.argv[2];

if (!url) {
  console.log('\x1b[31m%s\x1b[0m', 'You need to pass a URL');
  return;
}

getPublishDate(url)
  .then(date => {
    console.log(moment(date).format('YYYY-MM-DD'));
  })
  .catch(() => {
    console.log('\x1b[31m%s\x1b[0m', 'No date found');
  });