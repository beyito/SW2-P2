/** Imagen guardada, lista para servirse. */
export interface StoredMedia {
  contentType: string;
  data: Buffer;
}

export interface IMediaStorage {
  save(id: string, contentType: string, data: Buffer): Promise<void>;
  find(id: string): Promise<StoredMedia | null>;
  delete(id: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('IMediaStorage');
