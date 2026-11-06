import { ClosetItem } from '../../domain/entities/closet-item.entity';

export interface IClosetRepository {
  save(item: ClosetItem): Promise<ClosetItem>;
  findById(id: string): Promise<ClosetItem | null>;
  findByClientId(clientId: string): Promise<ClosetItem[]>;
  delete(id: string): Promise<boolean>;
}

export const CLOSET_REPOSITORY = Symbol('IClosetRepository');
