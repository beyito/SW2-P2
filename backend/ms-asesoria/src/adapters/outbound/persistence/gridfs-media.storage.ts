import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import { IMediaStorage, StoredMedia } from '../../../ports/outbound/media-storage.port';

const BUCKET = 'media';

/**
 * Guarda las imágenes en GridFS, dentro de MongoDB, para que el servicio no dependa de su disco.
 */
@Injectable()
export class GridFsMediaStorage implements IMediaStorage {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private bucket(): mongo.GridFSBucket {
    return new mongo.GridFSBucket(this.connection.db!, { bucketName: BUCKET });
  }

  save(id: string, contentType: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const upload = this.bucket().openUploadStream(id, { metadata: { contentType } });
      upload.on('error', reject);
      upload.on('finish', () => resolve());
      upload.end(data);
    });
  }

  async find(id: string): Promise<StoredMedia | null> {
    const bucket = this.bucket();
    const [file] = await bucket.find({ filename: id }).limit(1).toArray();
    if (!file) return null;

    const chunks: Buffer[] = [];
    for await (const chunk of bucket.openDownloadStream(file._id)) {
      chunks.push(chunk as Buffer);
    }
    return { contentType: file.metadata?.contentType, data: Buffer.concat(chunks) };
  }

  async delete(id: string): Promise<void> {
    const bucket = this.bucket();
    const files = await bucket.find({ filename: id }).toArray();
    await Promise.all(files.map((file) => bucket.delete(file._id)));
  }
}
