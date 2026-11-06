import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CommunityPostDocument = CommunityPostMongo & Document;

@Schema({ _id: false })
export class PostCommentMongo {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  authorId: string;

  @Prop({ required: true })
  authorName: string;

  // Un comentario eliminado guarda su contenido vacío, así que no puede ser obligatorio
  @Prop({ default: '' })
  content: string;

  @Prop({ type: String, default: null })
  parentId: string | null;

  @Prop({ default: false })
  deleted: boolean;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PostCommentSchema = SchemaFactory.createForClass(PostCommentMongo);

@Schema({ _id: false })
export class PostReportMongo {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  reason: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PostReportSchema = SchemaFactory.createForClass(PostReportMongo);

@Schema({ collection: 'community_posts', timestamps: true })
export class CommunityPostMongo {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  authorId: string;

  @Prop({ required: true })
  authorName: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ type: [String], default: [], index: true })
  likes: string[];

  @Prop({ type: [PostCommentSchema], default: [] })
  comments: PostCommentMongo[];

  @Prop({ default: 'VISIBLE', enum: ['VISIBLE', 'HIDDEN'], index: true })
  status: string;

  @Prop({ type: [PostReportSchema], default: [] })
  reports: PostReportMongo[];

  @Prop({ type: String, default: null })
  moderationReason: string | null;
}

export const CommunityPostSchema = SchemaFactory.createForClass(CommunityPostMongo);
