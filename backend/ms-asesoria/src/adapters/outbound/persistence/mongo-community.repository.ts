import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ICommunityRepository } from '../../../ports/outbound/community-repository.port';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';
import { CommunityPostDocument, CommunityPostMongo } from './schemas/community-post.schema';

@Injectable()
export class MongoCommunityRepository implements ICommunityRepository {
  constructor(
    @InjectModel(CommunityPostMongo.name)
    private readonly postModel: Model<CommunityPostDocument>,
  ) {}

  async save(post: CommunityPost): Promise<CommunityPost> {
    await this.postModel.findOneAndUpdate(
      { id: post.id },
      {
        id: post.id,
        authorId: post.authorId,
        authorName: post.authorName,
        title: post.title,
        description: post.description,
        imageUrl: post.imageUrl,
        likes: post.likes,
        comments: post.comments.map((c) => ({
          id: c.id,
          authorId: c.authorId,
          authorName: c.authorName,
          content: c.content,
          createdAt: c.createdAt,
        })),
      },
      { upsert: true, new: true },
    );
    return post;
  }

  async findAll(): Promise<CommunityPost[]> {
    const docs = await this.postModel.find().sort({ createdAt: -1 }).exec();
    return docs.map(this.toDomain);
  }

  async findById(id: string): Promise<CommunityPost | null> {
    const doc = await this.postModel.findOne({ id }).exec();
    if (!doc) return null;
    return this.toDomain(doc);
  }

  private toDomain(doc: CommunityPostDocument): CommunityPost {
    return new CommunityPost({
      id: doc.id,
      authorId: doc.authorId,
      authorName: doc.authorName,
      title: doc.title,
      description: doc.description,
      imageUrl: doc.imageUrl,
      likes: doc.likes || [],
      comments: (doc.comments || []).map(
        (c) =>
          new PostComment({
            id: c.id,
            authorId: c.authorId,
            authorName: c.authorName,
            content: c.content,
            createdAt: c.createdAt,
          }),
      ),
      createdAt: (doc as any).createdAt,
    });
  }
}
