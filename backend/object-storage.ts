import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export const putR2Object = async (key: string, body: Buffer, contentType: string) => {
  await client().send(new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: key,
    Body: body,
    ContentLength: body.length,
    ContentType: contentType,
    CacheControl: 'private, max-age=300',
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
  };
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

export const signedR2UploadUrl = (key: string, contentType: string, size: number) => getSignedUrl(
  client(),
  new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  }),
  { expiresIn: env.r2SignedUrlTtlSeconds },
);

export const r2SignedUrlExpiresAt = () => new Date(
  Date.now() + env.r2SignedUrlTtlSeconds * 1000,
).toISOString();
