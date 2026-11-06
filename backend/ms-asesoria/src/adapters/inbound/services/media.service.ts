import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IMediaStorage, MEDIA_STORAGE, StoredMedia } from '../../../ports/outbound/media-storage.port';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_PATH = /^\/media\/([a-f0-9]{32})$/;

/** Ruta interna de una imagen subida a la plataforma. */
export const isMediaPath = (value: unknown): boolean => typeof value === 'string' && MEDIA_PATH.test(value);

/** Identifica la imagen por su contenido; el nombre y el tipo que envía el cliente no son confiables. */
function detectImageType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Caso de Uso: subir y servir las imágenes de la comunidad y del clóset (CU-15, CU-20).
 */
@Injectable()
export class MediaService {
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: IMediaStorage) {}

  async upload(data: Buffer | undefined): Promise<{ id: string; url: string }> {
    if (!data?.length) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Debe adjuntar una imagen.' });
    }
    const contentType = detectImageType(data);
    if (!contentType) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_IMAGE',
        message: 'Solo se aceptan imágenes JPEG, PNG o WebP.',
      });
    }
    const id = randomBytes(16).toString('hex');
    await this.storage.save(id, contentType, data);
    return { id, url: `/media/${id}` };
  }

  async get(id: string): Promise<StoredMedia> {
    const media = /^[a-f0-9]{32}$/.test(id) ? await this.storage.find(id) : null;
    if (!media) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Imagen no encontrada.' });
    }
    return media;
  }

  /** Borra la imagen de una ruta interna; las URL externas antiguas se ignoran. */
  async deleteByPath(path: string): Promise<void> {
    const match = MEDIA_PATH.exec(path);
    if (match) await this.storage.delete(match[1]);
  }
}
