import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { isMediaPath, MediaService } from './media.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('MediaService (imágenes de comunidad y clóset)', () => {
  let storage: { save: jest.Mock; find: jest.Mock; delete: jest.Mock };
  let service: MediaService;

  beforeEach(() => {
    storage = { save: jest.fn().mockResolvedValue(undefined), find: jest.fn(), delete: jest.fn() };
    service = new MediaService(storage);
  });

  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ])('acepta %s según su contenido', async (contentType, data) => {
    const result = await service.upload(data);

    expect(result.url).toBe(`/media/${result.id}`);
    expect(isMediaPath(result.url)).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(result.id, contentType, data);
  });

  it('rechaza con 400 una petición sin archivo', async () => {
    await expect(service.upload(undefined)).rejects.toThrow(BadRequestException);
  });

  it('rechaza con 422 un archivo que no es imagen, aunque se llame .png', async () => {
    await expect(service.upload(Buffer.from('<svg onload="alert(1)"></svg>'))).rejects.toThrow(UnprocessableEntityException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('responde 404 sin consultar si el identificador no tiene el formato esperado', async () => {
    await expect(service.get('../../etc/passwd')).rejects.toThrow(NotFoundException);
    expect(storage.find).not.toHaveBeenCalled();
  });

  it('solo borra rutas internas', async () => {
    await service.deleteByPath('https://images.unsplash.com/foto');
    expect(storage.delete).not.toHaveBeenCalled();

    const id = 'a'.repeat(32);
    await service.deleteByPath(`/media/${id}`);
    expect(storage.delete).toHaveBeenCalledWith(id);
  });
});
