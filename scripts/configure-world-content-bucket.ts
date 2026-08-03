import {
  PutBucketCorsCommand,
  S3Client,
  type CORSRule
} from '@aws-sdk/client-s3';
import {resolveBucketConfig} from '../server/storage/bucket-object-store.ts';

const RULE_ID = 'nock0-world-content-read';
const origins = process.argv.slice(2).filter((value) => value.startsWith('http'));
if (origins.length === 0) {
  throw new Error(
    'Usage: npm run world:configure-bucket -- https://hoodlyfe.up.railway.app [additional-origin]'
  );
}

const config = resolveBucketConfig();
if (!config) throw new Error('World bucket configuration is unavailable. Run through railway run.');

const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: config.forcePathStyle,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
  }
});

const worldContentRule: CORSRule = {
  ID: RULE_ID,
  AllowedOrigins: [...new Set(origins)],
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  MaxAgeSeconds: 3600
};

await client.send(new PutBucketCorsCommand({
  Bucket: config.bucket,
  CORSConfiguration: {CORSRules: [worldContentRule]}
}));

console.log(JSON.stringify({
  bucket: config.bucket,
  rule: worldContentRule
}, null, 2));
