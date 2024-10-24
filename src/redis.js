import Redis from 'ioredis';

const redisUrl = process.env.REDIS_TLS_URL;
const options = {
  maxRetriesPerRequest: null
};

if (redisUrl.includes('rediss://')) {
  options.tls = {
    rejectUnauthorized: false
  };
}

export default function getRedisConnection() {
  return new Redis(redisUrl, options);
}
