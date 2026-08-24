import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { env } from './env';

const endpoint = env.r2Endpoint || (env.r2AccountId
  ? `https://${env.r2AccountId}.r2.cloudflarestorage.com`
  : '');

const r2 = env.storageDriver === 'r2'
  ? new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
  })
  : null;

const client = () => {
  if (!r2) throw new Error('R2 object storage is not enabled.');
  return r2;
};

export const usesR2Storage = env.storageDriver === 'r2';

export const putR2Object = async (
  key: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
) => {
  await client().send(new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: key,
    Body: body,
    ContentLength: body.length,
    ContentType: contentType,
    Metadata: metadata,
    CacheControl: 'private, max-age=300',
  }));
};

export const putR2ObjectStream = async (
  key: string,
  body: Readable,
  contentLength: number,
  contentType: string,
  metadata: Record<string, string> = {},
) => {
  await client().send(new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType,
    Metadata: metadata,
    CacheControl: Object.keys(metadata).length
      ? (key.includes('/documents/') ? 'private, max-age=31536000, immutable' : 'private, max-age=300')
      : undefined,
  }));
};

export const deleteR2Object = async (key: string) => {
  await client().send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }));
};

export const deleteR2Prefix = async (prefix: string) => {
  let continuationToken: string | undefined;
  do {
    const listed = await client().send(new ListObjectsV2Command({
      Bucket: env.r2BucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const object of listed.Contents || []) {
      if (object.Key) await deleteR2Object(object.Key);
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
};

export const headR2Object = async (key: string) => {
  const object = await client().send(new HeadObjectCommand({ Bucket: env.r2BucketName, Key: key }));
  return {
    contentType: object.ContentType || 'application/octet-stream',
    size: Number(object.ContentLength || 0),
    etag: object.ETag || null,
    metadata: object.Metadata || {},
    lastModified: object.LastModified?.toISOString() || null,
  };
};

export type R2ObjectSummary = {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
};

/** Iterates one R2 listing page at a time so object keys, never file bodies, are held in memory. */
export const inspectR2Prefix = async (
  prefix: string,
  visitor: (object: R2ObjectSummary) => void | Promise<void>,
) => {
  let continuationToken: string | undefined;
  let count = 0;
  let totalSize = 0;
  do {
    const listed = await client().send(new ListObjectsV2Command({
      Bucket: env.r2BucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const object of listed.Contents || []) {
      if (!object.Key) continue;
      const entry = {
        key: object.Key,
        size: Number(object.Size || 0),
        etag: object.ETag || null,
        lastModified: object.LastModified?.toISOString() || null,
      };
      count += 1;
      totalSize += entry.size;
      await visitor(entry);
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return { count, totalSize };
};

export const readR2Object = async (key: string) => {
  const object = await client().send(new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }));
  if (!object.Body) throw new Error(`R2 object has no body: ${key}`);
  const body = Buffer.from(await object.Body.transformToByteArray());
  return {
    body,
    contentType: object.ContentType || 'application/octet-stream',
    size: Number(object.ContentLength ?? body.length),
    etag: object.ETag || null,
  };
};

export const signedR2DownloadUrl = (key: string) => getSignedUrl(
  client(),
  new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }),
  { expiresIn: env.r2SignedUrlTtlSeconds },
);

export const signedR2UploadUrl = (
  key: string,
  contentType: string,
  size: number,
  metadata: Record<string, string> = {},
) => getSignedUrl(
  client(),
  new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
    Metadata: metadata,
    CacheControl: Object.keys(metadata).length
      ? (key.includes('/documents/') ? 'private, max-age=31536000, immutable' : 'private, max-age=300')
      : undefined,
  }),
  { expiresIn: env.r2SignedUrlTtlSeconds },
);

export const r2SignedUrlExpiresAt = () => new Date(
  Date.now() + env.r2SignedUrlTtlSeconds * 1000,
).toISOString();
