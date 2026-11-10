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
    if (!file) throw badRequest('Attach an image in the `file` field');
    const ext = TYPES[file.mimetype];
    if (!ext) throw badRequest('Upload a JPEG, PNG, WebP or AVIF image');
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest('The image must be 5 MB or smaller');
    const key = `${folder}/${randomUUID()}.${ext}`;

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
