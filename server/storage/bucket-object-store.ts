import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export interface BucketConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
}

let cachedClient: S3Client | undefined;
let cachedConfig: BucketConfig | undefined;

export function resolveBucketConfig(
  environment: Record<string, string | undefined> = process.env
): BucketConfig | undefined {
  const endpoint = environment.AWS_ENDPOINT_URL ?? environment.BUCKET_ENDPOINT ?? environment.ENDPOINT;
  const accessKeyId = environment.AWS_ACCESS_KEY_ID ?? environment.BUCKET_ACCESS_KEY_ID ?? environment.ACCESS_KEY_ID;
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY ?? environment.BUCKET_SECRET_ACCESS_KEY ?? environment.SECRET_ACCESS_KEY;
  const bucket = environment.AWS_S3_BUCKET_NAME ?? environment.BUCKET_NAME ?? environment.BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return undefined;
  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: environment.AWS_DEFAULT_REGION ?? environment.BUCKET_REGION ?? environment.REGION ?? 'auto',
    forcePathStyle: (environment.AWS_S3_URL_STYLE ?? 'virtual') === 'path'
  };
}

export function bucketStorageEnabled(): boolean {
  return Boolean(resolveBucketConfig());
}

export async function putBucketObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  cacheControl = 'public, max-age=31536000, immutable'
): Promise<void> {
  const {client, config} = configuredClient();
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl
  }));
}

export async function putBucketJson(
  key: string,
  value: unknown,
  cacheControl: string
): Promise<void> {
  await putBucketObject(
    key,
    Buffer.from(`${JSON.stringify(value)}\n`),
    'application/json; charset=utf-8',
    cacheControl
  );
}

export async function readBucketJson<T>(key: string): Promise<T | undefined> {
  const body = await readBucketObject(key);
  return body === undefined ? undefined : JSON.parse(new TextDecoder().decode(body)) as T;
}

export async function readBucketObject(key: string): Promise<Uint8Array | undefined> {
  const {client, config} = configuredClient();
  try {
    const response = await client.send(new GetObjectCommand({Bucket: config.bucket, Key: key}));
    if (!response.Body) return undefined;
    return response.Body.transformToByteArray();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function bucketObjectExists(key: string): Promise<boolean> {
  const {client, config} = configuredClient();
  try {
    await client.send(new HeadObjectCommand({Bucket: config.bucket, Key: key}));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function signedBucketObjectUrl(key: string, expiresIn = 900): Promise<string> {
  const {client, config} = configuredClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({Bucket: config.bucket, Key: key}),
    {expiresIn}
  );
}

function configuredClient(): {client: S3Client; config: BucketConfig} {
  const config = resolveBucketConfig();
  if (!config) throw new Error('Bucket object storage is not configured.');
  if (!cachedClient || JSON.stringify(config) !== JSON.stringify(cachedConfig)) {
    cachedClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey}
    });
    cachedConfig = config;
  }
  return {client: cachedClient, config};
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {$metadata?: {httpStatusCode?: number}; name?: string};
  return candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NoSuchKey' || candidate.name === 'NotFound';
}
