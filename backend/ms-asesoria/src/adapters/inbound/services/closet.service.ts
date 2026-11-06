import { Injectable, Inject } from '@nestjs/common';
import { IClosetUseCase, CreateClosetItemDto } from '../../../ports/inbound/closet.use-case.port';
import { IClosetRepository, CLOSET_REPOSITORY } from '../../../ports/outbound/closet-repository.port';
import { ClosetItem } from '../../../domain/entities/closet-item.entity';

@Injectable()
export class ClosetService implements IClosetUseCase {
  constructor(
    @Inject(CLOSET_REPOSITORY)
    private readonly closetRepository: IClosetRepository,
  ) {}

  async addItem(dto: CreateClosetItemDto): Promise<ClosetItem> {
    const item = new ClosetItem({
      id: 'closet-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: dto.clientId,
      name: dto.name,
      category: dto.category,
      color: dto.color,
      season: dto.season,
      imageUrl: dto.imageUrl,
      tags: dto.tags || [],
    });
    return this.closetRepository.save(item);
  }

  async getItemsByClient(clientId: string): Promise<ClosetItem[]> {
    return this.closetRepository.findByClientId(clientId);
  }

  async getItemById(id: string): Promise<ClosetItem | null> {
    return this.closetRepository.findById(id);
  }

  async removeItem(id: string): Promise<boolean> {
    return this.closetRepository.delete(id);
  }
}
