import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClosetService } from './closet.service';
import { CLOSET_REPOSITORY } from '../../../ports/outbound/closet-repository.port';
import { ClosetItem } from '../../../domain/entities/closet-item.entity';
import { MediaService } from './media.service';

describe('ClosetService (CU-15: Gestión de Armario Virtual)', () => {
  let service: ClosetService;
  let mockRepository: any;

  beforeEach(async () => {
    mockRepository = {
      save: jest.fn().mockImplementation((item) => Promise.resolve(item)),
      findByClientId: jest.fn().mockResolvedValue([
        new ClosetItem({
          id: 'closet-1',
          clientId: 'client-01',
          name: 'Blazer Marino',
          category: 'OUTERWEAR',
          color: 'Azul Marino',
          season: 'AUTUMN',
          imageUrl: 'https://example.com/blazer.jpg',
          tags: ['elegante', 'oficina'],
        }),
      ]),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === 'closet-1') {
          return Promise.resolve(
            new ClosetItem({
              id: 'closet-1',
              clientId: 'client-01',
              name: 'Blazer Marino',
              category: 'OUTERWEAR',
              color: 'Azul Marino',
              season: 'AUTUMN',
              imageUrl: 'https://example.com/blazer.jpg',
              tags: ['elegante'],
            }),
          );
        }
        return Promise.resolve(null);
      }),
      delete: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClosetService,
        { provide: MediaService, useValue: { deleteByPath: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: CLOSET_REPOSITORY,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ClosetService>(ClosetService);
  });

  it('debe registrar una nueva prenda en el clóset virtual (CU-15)', async () => {
    const dto = {
      clientId: 'client-01',
      name: 'Vestido Seda Dorado',
      category: 'TOP' as const,
      color: 'Dorado',
      season: 'SUMMER' as const,
      imageUrl: 'https://example.com/vestido.jpg',
      tags: ['gala', 'fiesta'],
    };

    const result = await service.addItem(dto);

    expect(result).toBeDefined();
    expect(result.name).toBe('Vestido Seda Dorado');
    expect(result.category).toBe('TOP');
    expect(result.season).toBe('SUMMER');
    expect(result.imageUrl).toBe('https://example.com/vestido.jpg');
    expect(mockRepository.save).toHaveBeenCalledTimes(1);
  });

  it('debe consultar las prendas de un cliente específico', async () => {
    const items = await service.getItemsByClient('client-01');

    expect(items).toBeInstanceOf(Array);
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('Blazer Marino');
    expect(mockRepository.findByClientId).toHaveBeenCalledWith('client-01');
  });

  it('debe obtener una prenda por ID si existe', async () => {
    const item = await service.getItemById('closet-1');

    expect(item).toBeDefined();
    expect(item?.id).toBe('closet-1');
  });

  it('debe eliminar una prenda existente', async () => {
    const deleted = await service.removeItem('closet-1');

    expect(deleted).toBe(true);
    expect(mockRepository.delete).toHaveBeenCalledWith('closet-1');
  });

  it('rechaza con 400 categoría, temporada o imagen inválidas', async () => {
    const valid = { clientId: 'c', name: 'Blazer', color: 'Azul', category: 'TOP' as const, season: 'SUMMER' as const };

    await expect(service.addItem({ ...valid, category: 'SOMBRERO' as any })).rejects.toThrow(BadRequestException);
    await expect(service.addItem({ ...valid, season: 'NUNCA' as any })).rejects.toThrow(BadRequestException);
    await expect(service.addItem({ ...valid, imageUrl: 'javascript:alert(1)' })).rejects.toThrow(BadRequestException);
    await expect(service.addItem({ ...valid, name: '  ' })).rejects.toThrow(BadRequestException);
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('una edición solo cambia los campos enviados', async () => {
    const updated = await service.updateItem('closet-1', { color: 'Negro' });

    expect(updated.color).toBe('Negro');
    expect(updated.name).toBe('Blazer Marino');
  });

  it('editar una prenda inexistente responde 404', async () => {
    await expect(service.updateItem('nada', { color: 'Negro' })).rejects.toThrow(NotFoundException);
  });
});
