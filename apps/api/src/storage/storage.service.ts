import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { badRequest } from '../common/errors';

export const UPLOADS_DIR = join(process.cwd(), 'uploads');
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Raster images only. SVG is refused because it can carry scripts. */
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Recognises an image by its signature. Returns its MIME type, or null. */
export function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('latin1', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(b.toString('latin1', 8, 12))) return 'image/avif';
  return null;
}

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Photo storage. Uses S3 (or any S3-compatible store) when `S3_BUCKET` is set, and the
 * local `uploads/` folder otherwise, so the project runs without cloud credentials.
 */
@Injectable()
export class StorageService {
  private readonly s3?: S3Client;
  private readonly bucket?: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET') || undefined;
    if (this.bucket) {
      const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
      this.s3 = new S3Client({
        region: this.config.get<string>('S3_REGION') ?? 'eu-central-1',
        endpoint: this.config.get<string>('S3_ENDPOINT') || undefined,
        forcePathStyle: !!this.config.get<string>('S3_ENDPOINT'),
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      });
    }
  }

  async saveImage(file: UploadedImage | undefined, folder: 'barbers' | 'products'): Promise<string> {
    if (!file?.buffer?.length) throw badRequest('Attach an image in the `file` field');
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest('The image must be 5 MB or smaller');
    // The type comes from the file's own first bytes, never from what the uploader claims:
    // a script renamed to .png is not an image.
    const mimetype = sniffImage(file.buffer);
    if (!mimetype) throw badRequest('Upload a JPEG, PNG, WebP or AVIF image');
    const key = `${folder}/${randomUUID()}.${TYPES[mimetype]}`;
    file = { ...file, mimetype };

    if (this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      const base =
        this.config.get<string>('S3_PUBLIC_URL') ||
        `https://${this.bucket}.s3.${this.config.get('S3_REGION') ?? 'eu-central-1'}.amazonaws.com`;
      return `${base.replace(/\/$/, '')}/${key}`;
    }

    await mkdir(join(UPLOADS_DIR, folder), { recursive: true });
    await writeFile(join(UPLOADS_DIR, key), file.buffer);
    return `/uploads/${key}`;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
