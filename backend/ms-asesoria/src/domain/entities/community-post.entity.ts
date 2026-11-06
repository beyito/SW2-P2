/**
 * Entidad de Dominio: Publicación en Muro Comunitario (CU-20, CU-21)
 */
export class PostComment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;

  constructor(partial: Partial<PostComment>) {
    Object.assign(this, partial);
    this.createdAt = partial.createdAt || new Date();
  }
}

export class CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  imageUrl: string;
  likes: string[]; // Lista de IDs de usuarios que dieron like (toggle-like)
  comments: PostComment[];
  createdAt: Date;

  constructor(partial: Partial<CommunityPost>) {
    Object.assign(this, partial);
    this.likes = partial.likes || [];
    this.comments = partial.comments || [];
    this.createdAt = partial.createdAt || new Date();
  }

  toggleLike(userId: string): boolean {
    const index = this.likes.indexOf(userId);
    if (index > -1) {
      this.likes.splice(index, 1);
      return false; // Like removido
    } else {
      this.likes.push(userId);
      return true; // Like agregado
    }
  }

  addComment(comment: PostComment): void {
    this.comments.push(comment);
  }
}
