import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ICommunityRepository } from '../../../ports/outbound/community-repository.port';
import { CommunityPost, PostComment, PostReport } from '../../../domain/entities/community-post.entity';
import { CommunityPostDocument, CommunityPostMongo } from './schemas/community-post.schema';

const MAX_WALL_POSTS = 50;
// Las publicaciones anteriores a la moderación no tienen estado: cuentan como visibles
const NOT_HIDDEN = { status: { $ne: 'HIDDEN' } };

@Injectable()
export class MongoCommunityRepository implements ICommunityRepository {
  constructor(
    @InjectModel(CommunityPostMongo.name)
    private readonly postModel: Model<CommunityPostDocument>,
  ) {}

  async create(post: CommunityPost): Promise<CommunityPost> {
    const created = await this.postModel.create({
      id: post.id,
      authorId: post.authorId,
      authorName: post.authorName,
      title: post.title,
      description: post.description,
      imageUrl: post.imageUrl,
    });
    return this.toDomain(created);
  }

  async findWall(viewerId: string): Promise<CommunityPost[]> {
    const docs = await this.postModel
      .find({ $or: [NOT_HIDDEN, { authorId: viewerId }] })
      .sort({ createdAt: -1 })
      .limit(MAX_WALL_POSTS)
      .exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findById(id: string): Promise<CommunityPost | null> {
    const doc = await this.postModel.findOne({ id }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.postModel.deleteOne({ id }).exec();
    return result.deletedCount > 0;
  }

  async toggleLike(postId: string, userId: string): Promise<CommunityPost | null> {
    const user = { $literal: userId };
    const likes = { $ifNull: ['$likes', []] };
    // Una sola actualización en la base: dos clics simultáneos no pueden perder ni duplicar un like
    const doc = await this.postModel
      .findOneAndUpdate(
        { id: postId, ...NOT_HIDDEN },
        [
          {
            $set: {
              likes: {
                $cond: [{ $in: [user, likes] }, { $setDifference: [likes, [user]] }, { $concatArrays: [likes, [user]] }],
              },
            },
          },
        ],
        { new: true },
      )
      .exec();
    return doc ? this.toDomain(doc) : null;
  }

  async pushComment(postId: string, comment: PostComment): Promise<boolean> {
    const filter: Record<string, unknown> = { id: postId, ...NOT_HIDDEN };
    if (comment.parentId) {
      filter.comments = { $elemMatch: { id: comment.parentId, deleted: { $ne: true } } };
    }
    const result = await this.postModel
      .updateOne(filter, {
        $push: {
          comments: {
            id: comment.id,
            parentId: comment.parentId,
            authorId: comment.authorId,
            authorName: comment.authorName,
            content: comment.content,
            deleted: false,
            createdAt: comment.createdAt,
          },
        },
      })
      .exec();
    return result.modifiedCount > 0;
  }

  async markCommentDeleted(postId: string, commentId: string): Promise<boolean> {
    const result = await this.postModel
      .updateOne(
        { id: postId, 'comments.id': commentId },
        { $set: { 'comments.$.deleted': true, 'comments.$.content': '' } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async addReport(postId: string, report: PostReport): Promise<boolean> {
    const result = await this.postModel
      .updateOne({ id: postId, 'reports.userId': { $ne: report.userId } }, { $push: { reports: report } })
      .exec();
    return result.modifiedCount > 0;
  }

  async findModerationQueue(): Promise<CommunityPost[]> {
    const docs = await this.postModel
      .find({ $or: [{ status: 'HIDDEN' }, { 'reports.0': { $exists: true } }] })
      .sort({ updatedAt: -1 })
      .exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  async hide(postId: string, reason: string): Promise<CommunityPost | null> {
    const doc = await this.postModel
      .findOneAndUpdate({ id: postId }, { $set: { status: 'HIDDEN', moderationReason: reason } }, { new: true })
      .exec();
    return doc ? this.toDomain(doc) : null;
  }

  async restore(postId: string): Promise<CommunityPost | null> {
    // Restaurar cierra el caso: las denuncias ya revisadas dejan la cola
    const doc = await this.postModel
      .findOneAndUpdate(
        { id: postId },
        { $set: { status: 'VISIBLE', moderationReason: null, reports: [] } },
        { new: true },
      )
      .exec();
    return doc ? this.toDomain(doc) : null;
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
            parentId: c.parentId,
            authorId: c.authorId,
            authorName: c.authorName,
            content: c.content,
            deleted: c.deleted,
            createdAt: c.createdAt,
          }),
      ),
      status: doc.status === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE',
      reports: (doc.reports || []).map((r) => ({ userId: r.userId, reason: r.reason, createdAt: r.createdAt })),
      moderationReason: doc.moderationReason,
      createdAt: (doc as any).createdAt,
    });
  }
}
