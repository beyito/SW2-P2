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

  @Prop({ required: true })
  content: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PostCommentSchema = SchemaFactory.createForClass(PostCommentMongo);

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
}

export const CommunityPostSchema = SchemaFactory.createForClass(CommunityPostMongo);
