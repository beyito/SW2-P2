import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IClosetRepository } from '../../../ports/outbound/closet-repository.port';
import { ClosetItem } from '../../../domain/entities/closet-item.entity';
import { ClosetItemDocument, ClosetItemMongo } from './schemas/closet-item.schema';

@Injectable()
export class MongoClosetRepository implements IClosetRepository {
  constructor(
    @InjectModel(ClosetItemMongo.name)
    private readonly closetModel: Model<ClosetItemDocument>,
  ) {}

  async save(item: ClosetItem): Promise<ClosetItem> {
    await this.closetModel.findOneAndUpdate(
      { id: item.id },
      {
        id: item.id,
        clientId: item.clientId,
        name: item.name,
        category: item.category,
        color: item.color,
        season: item.season,
        imageUrl: item.imageUrl,
        tags: item.tags,
      },
      { upsert: true, new: true },
    );
    return item;
  }

  async findById(id: string): Promise<ClosetItem | null> {
    const doc = await this.closetModel.findOne({ id }).exec();
    if (!doc) return null;
    return new ClosetItem({
      id: doc.id,
      clientId: doc.clientId,
      name: doc.name,
      category: doc.category as any,
      color: doc.color,
      season: doc.season as any,
      imageUrl: doc.imageUrl,
      tags: doc.tags,
    });
  }

  async findByClientId(clientId: string): Promise<ClosetItem[]> {
    const docs = await this.closetModel.find({ clientId }).exec();
    return docs.map(
      (doc) =>
        new ClosetItem({
          id: doc.id,
          clientId: doc.clientId,
          name: doc.name,
          category: doc.category as any,
          color: doc.color,
          season: doc.season as any,
          imageUrl: doc.imageUrl,
          tags: doc.tags,
        }),
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.closetModel.deleteOne({ id }).exec();
    return res.deletedCount > 0;
  }
}
