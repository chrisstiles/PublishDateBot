///////////////////////
// Used for testing URLs
///////////////////////

import getPublishDate from './get-publish-date';
import moment from 'moment';

const url = process.argv[2];

if (url) {
  getPublishDate(url)
    .then(date => {
      console.log(moment(date).format('YYYY-MM-DD'));
    })
    .catch(() => {
      console.log('\x1b[31m%s\x1b[0m', 'No date found');
    });
} else {
  console.log('\x1b[31m%s\x1b[0m', 'You need to pass a URL');
}
