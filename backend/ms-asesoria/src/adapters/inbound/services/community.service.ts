import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ICommunityUseCase, CreatePostDto, AddCommentDto } from '../../../ports/inbound/community.use-case.port';
import { ICommunityRepository, COMMUNITY_REPOSITORY } from '../../../ports/outbound/community-repository.port';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';

@Injectable()
export class CommunityService implements ICommunityUseCase {
  constructor(
    @Inject(COMMUNITY_REPOSITORY)
    private readonly communityRepository: ICommunityRepository,
  ) {}

  async createPost(dto: CreatePostDto): Promise<CommunityPost> {
    const post = new CommunityPost({
      id: 'post-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      authorId: dto.authorId,
      authorName: dto.authorName,
      title: dto.title,
      description: dto.description,
      imageUrl: dto.imageUrl,
      likes: [],
      comments: [],
    });
    return this.communityRepository.save(post);
  }

  async getAllPosts(): Promise<CommunityPost[]> {
    return this.communityRepository.findAll();
  }

  async getPostById(id: string): Promise<CommunityPost | null> {
    return this.communityRepository.findById(id);
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; totalLikes: number }> {
    const post = await this.communityRepository.findById(postId);
    if (!post) {
      throw new NotFoundException(`Publicación no encontrada con ID: ${postId}`);
    }
    const liked = post.toggleLike(userId);
    await this.communityRepository.save(post);
    return { liked, totalLikes: post.likes.length };
  }

  async addComment(postId: string, dto: AddCommentDto): Promise<PostComment> {
    const post = await this.communityRepository.findById(postId);
    if (!post) {
      throw new NotFoundException(`Publicación no encontrada con ID: ${postId}`);
    }
    const comment = new PostComment({
      id: 'comment-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      authorId: dto.authorId,
      authorName: dto.authorName,
      content: dto.content,
    });
    post.addComment(comment);
    await this.communityRepository.save(post);
    return comment;
  }
}
