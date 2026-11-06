import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateClosetItemDto, IClosetUseCase, UpdateClosetItemDto } from '../../../ports/inbound/closet.use-case.port';
import { IClosetRepository, CLOSET_REPOSITORY } from '../../../ports/outbound/closet-repository.port';
import { ClosetItem } from '../../../domain/entities/closet-item.entity';
import { isMediaPath, MediaService } from './media.service';

const CATEGORIES = ['TOP', 'BOTTOM', 'SHOES', 'ACCESSORY', 'OUTERWEAR'];
const SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'ALL_SEASON'];
const MAX_TEXT = 80;

@Injectable()
export class ClosetService implements IClosetUseCase {
  private readonly logger = new Logger(ClosetService.name);

  constructor(
    @Inject(CLOSET_REPOSITORY)
    private readonly closetRepository: IClosetRepository,
    private readonly media: MediaService,
  ) {}

  async addItem(dto: CreateClosetItemDto): Promise<ClosetItem> {
    const item = new ClosetItem({
      id: randomUUID(),
      clientId: dto.clientId,
      tags: [],
      imageUrl: '',
    });
    this.applyChanges(item, dto, true);
    return this.closetRepository.save(item);
  }

  async getItemsByClient(clientId: string): Promise<ClosetItem[]> {
    return this.closetRepository.findByClientId(clientId);
  }

  async getItemById(id: string): Promise<ClosetItem | null> {
    return this.closetRepository.findById(id);
  }

  async updateItem(id: string, dto: UpdateClosetItemDto): Promise<ClosetItem> {
    const item = await this.closetRepository.findById(id);
    if (!item) {
      throw new NotFoundException(`Prenda no encontrada con ID: ${id}`);
    }
    this.applyChanges(item, dto, false);
    return this.closetRepository.save(item);
  }

  async removeItem(id: string): Promise<boolean> {
    const item = await this.closetRepository.findById(id);
    const removed = await this.closetRepository.delete(id);
    if (removed && item?.imageUrl) {
      await this.media.deleteByPath(item.imageUrl).catch((error) => {
        // La prenda ya no existe: una imagen huérfana no justifica informar un fallo
        this.logger.error(`No se pudo borrar la imagen de la prenda ${id}: ${error.message}`);
      });
    }
    return removed;
  }

  /** Valida y aplica los campos; al crear, los campos principales son obligatorios. */
  private applyChanges(item: ClosetItem, dto: UpdateClosetItemDto, creating: boolean): void {
    if (creating || dto.name !== undefined) item.name = this.requireText(dto.name, 'nombre');
    if (creating || dto.color !== undefined) item.color = this.requireText(dto.color, 'color');
    if (creating || dto.category !== undefined) {
      if (!CATEGORIES.includes(dto.category as string)) throw this.invalid('La categoría no es válida.');
      item.category = dto.category as ClosetItem['category'];
    }
    if (creating || dto.season !== undefined) {
      if (!SEASONS.includes(dto.season as string)) throw this.invalid('La temporada no es válida.');
      item.season = dto.season as ClosetItem['season'];
    }
    if (dto.imageUrl !== undefined) {
      // Una imagen propia o una URL web; nunca un esquema que el navegador pueda ejecutar
      if (dto.imageUrl && !isMediaPath(dto.imageUrl) && !/^https?:\/\//i.test(dto.imageUrl)) {
        throw this.invalid('La imagen no es válida.');
      }
      item.imageUrl = dto.imageUrl;
    }
    if (dto.tags !== undefined) {
      if (!Array.isArray(dto.tags) || dto.tags.some((tag) => typeof tag !== 'string')) {
        throw this.invalid('Las etiquetas no son válidas.');
      }
      item.tags = dto.tags;
    }
  }

  private requireText(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > MAX_TEXT) {
      throw this.invalid(`El campo ${field} es obligatorio y admite hasta ${MAX_TEXT} caracteres.`);
    }
    return text;
  }

  private invalid(message: string): BadRequestException {
    return new BadRequestException({ code: 'INVALID_ITEM', message });
  }
}
