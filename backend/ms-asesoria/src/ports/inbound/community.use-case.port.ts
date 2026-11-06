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
  parentId?: string | null;
}

/** Quien realiza la acción; el personal puede moderar. */
export interface Actor {
  id: string;
  isStaff: boolean;
}

export interface ICommunityUseCase {
  createPost(dto: CreatePostDto): Promise<CommunityPost>;
  getWall(viewer: Actor): Promise<CommunityPost[]>;
  getPost(id: string, viewer: Actor): Promise<CommunityPost>;
  deletePost(id: string, actor: Actor): Promise<void>;
  toggleLike(postId: string, userId: string): Promise<{ liked: boolean; totalLikes: number }>;
  addComment(postId: string, dto: AddCommentDto): Promise<PostComment>;
  deleteComment(postId: string, commentId: string, actor: Actor): Promise<void>;
  reportPost(postId: string, userId: string, reason: string): Promise<void>;
  getModerationQueue(): Promise<CommunityPost[]>;
  hidePost(postId: string, reason: string): Promise<CommunityPost>;
  restorePost(postId: string): Promise<CommunityPost>;
}

export const COMMUNITY_USE_CASE = Symbol('ICommunityUseCase');
