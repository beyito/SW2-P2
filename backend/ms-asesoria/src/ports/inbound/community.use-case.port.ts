import { CommunityPost, PostComment } from '../../domain/entities/community-post.entity';

export interface CreatePostDto {
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  imageUrl: string;
}

export interface AddCommentDto {
  authorId: string;
  authorName: string;
  content: string;
}

export interface ICommunityUseCase {
  createPost(dto: CreatePostDto): Promise<CommunityPost>;
  getAllPosts(): Promise<CommunityPost[]>;
  getPostById(id: string): Promise<CommunityPost | null>;
  toggleLike(postId: string, userId: string): Promise<{ liked: boolean; totalLikes: number }>;
  addComment(postId: string, dto: AddCommentDto): Promise<PostComment>;
}

export const COMMUNITY_USE_CASE = Symbol('ICommunityUseCase');
