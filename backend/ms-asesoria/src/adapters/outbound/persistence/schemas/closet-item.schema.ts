import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClosetItemDocument = ClosetItemMongo & Document;

@Schema({ collection: 'virtual_closet_items', timestamps: true })
export class ClosetItemMongo {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  clientId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: ['TOP', 'BOTTOM', 'SHOES', 'ACCESSORY', 'OUTERWEAR'], index: true })
  category: string;

  @Prop({ required: true })
  color: string;

  @Prop({ required: true, enum: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'ALL_SEASON'], index: true })
  season: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ type: [String], default: [] })
  tags: string[];
}

export const ClosetItemSchema = SchemaFactory.createForClass(ClosetItemMongo);
