/**
 * Entidad de Dominio: Publicación en Muro Comunitario (CU-20, CU-21)
 */
export const MAX_COMMENT_DEPTH = 3;

export class PostComment {
  id: string;
  /** Comentario al que responde; vacío si es de primer nivel. */
  parentId?: string | null;
  authorId: string;
  authorName: string;
  content: string;
  /** Un comentario eliminado conserva su lugar para no romper las respuestas. */
  deleted: boolean;
  createdAt: Date;

  constructor(partial: Partial<PostComment>) {
    Object.assign(this, partial);
    this.parentId = partial.parentId ?? null;
    this.deleted = partial.deleted ?? false;
    this.createdAt = partial.createdAt || new Date();
  }
}

export interface PostReport {
  userId: string;
  reason: string;
  createdAt: Date;
}

export type PostStatus = 'VISIBLE' | 'HIDDEN';

export class CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  imageUrl: string;
  likes: string[]; // Lista de IDs de usuarios que dieron like (toggle-like)
  comments: PostComment[];
  status: PostStatus;
  reports: PostReport[];
  moderationReason?: string | null;
  createdAt: Date;

  constructor(partial: Partial<CommunityPost>) {
    Object.assign(this, partial);
    this.likes = partial.likes || [];
    this.comments = partial.comments || [];
    this.status = partial.status || 'VISIBLE';
    this.reports = partial.reports || [];
    this.moderationReason = partial.moderationReason ?? null;
    this.createdAt = partial.createdAt || new Date();
  }

  isHidden(): boolean {
    return this.status === 'HIDDEN';
  }

  /** Nivel que tendría una respuesta al comentario indicado; null si ese comentario no admite respuestas. */
  depthOfReplyTo(parentId: string): number | null {
    let depth = 1;
    let current = this.comments.find((comment) => comment.id === parentId);
    if (!current || current.deleted) return null;
    while (current) {
      depth += 1;
      const ancestorId: string | null | undefined = current.parentId;
      current = ancestorId ? this.comments.find((comment) => comment.id === ancestorId) : undefined;
    }
    return depth;
  }
}
