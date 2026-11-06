import { ClosetItem } from '../../domain/entities/closet-item.entity';

export interface CreateClosetItemDto {
  clientId: string;
  name: string;
  category: 'TOP' | 'BOTTOM' | 'SHOES' | 'ACCESSORY' | 'OUTERWEAR';
  color: string;
  season: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER' | 'ALL_SEASON';
  imageUrl: string;
  tags?: string[];
}

export interface IClosetUseCase {
  addItem(dto: CreateClosetItemDto): Promise<ClosetItem>;
  getItemsByClient(clientId: string): Promise<ClosetItem[]>;
  getItemById(id: string): Promise<ClosetItem | null>;
  removeItem(id: string): Promise<boolean>;
}

export const CLOSET_USE_CASE = Symbol('IClosetUseCase');
