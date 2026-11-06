import { CommunityPost, PostComment, PostReport } from '../../domain/entities/community-post.entity';

export interface ICommunityRepository {
  /** Inserta una publicación nueva. */
  create(post: CommunityPost): Promise<CommunityPost>;
  /** Publicaciones visibles, más las ocultas del propio usuario. */
  findWall(viewerId: string): Promise<CommunityPost[]>;
  findById(id: string): Promise<CommunityPost | null>;
  delete(id: string): Promise<boolean>;
  /** Alterna el like en una sola operación atómica; null si la publicación no está disponible. */
  toggleLike(postId: string, userId: string): Promise<CommunityPost | null>;
  /** Agrega el comentario solo si la publicación sigue visible y su padre existe. */
  pushComment(postId: string, comment: PostComment): Promise<boolean>;
  markCommentDeleted(postId: string, commentId: string): Promise<boolean>;
  /** Registra la denuncia; false si ese usuario ya había denunciado. */
  addReport(postId: string, report: PostReport): Promise<boolean>;
  /** Publicaciones denunciadas u ocultas. */
  findModerationQueue(): Promise<CommunityPost[]>;
  hide(postId: string, reason: string): Promise<CommunityPost | null>;
  restore(postId: string): Promise<CommunityPost | null>;
}

export const COMMUNITY_REPOSITORY = Symbol('ICommunityRepository');
