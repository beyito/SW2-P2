import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Actor,
  AddCommentDto,
  CreatePostDto,
  ICommunityUseCase,
} from '../../../ports/inbound/community.use-case.port';
import { COMMUNITY_REPOSITORY, ICommunityRepository } from '../../../ports/outbound/community-repository.port';
import { EVENT_PUBLISHER, IEventPublisher } from '../../../ports/outbound/event-publisher.port';
import { CommunityPost, MAX_COMMENT_DEPTH, PostComment } from '../../../domain/entities/community-post.entity';
import { isMediaPath, MediaService } from './media.service';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;
const MAX_COMMENT = 1000;
const MAX_REASON = 200;

/** Devuelve el texto sin espacios sobrantes, o rechaza la petición si no es válido. */
function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `El campo ${field} es obligatorio.` });
  }
  if (text.length > max) {
    throw new BadRequestException({ code: 'FIELD_TOO_LONG', message: `El campo ${field} supera los ${max} caracteres.` });
  }
  return text;
}

const notFound = (id: string) => new NotFoundException(`Publicación no encontrada con ID: ${id}`);

@Injectable()
export class CommunityService implements ICommunityUseCase {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @Inject(COMMUNITY_REPOSITORY) private readonly communityRepository: ICommunityRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: IEventPublisher,
    private readonly media: MediaService,
  ) {}

  async createPost(dto: CreatePostDto): Promise<CommunityPost> {
    if (!isMediaPath(dto.imageUrl)) {
      throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: 'La publicación debe llevar una imagen subida a la plataforma.' });
    }
    return this.communityRepository.create(
      new CommunityPost({
        id: randomUUID(),
        authorId: dto.authorId,
        authorName: dto.authorName,
        title: requireText(dto.title, 'título', MAX_TITLE),
        description: requireText(dto.description, 'descripción', MAX_DESCRIPTION),
        imageUrl: dto.imageUrl,
      }),
    );
  }

  async getWall(viewer: Actor): Promise<CommunityPost[]> {
    return this.communityRepository.findWall(viewer.id);
  }

  async getPost(id: string, viewer: Actor): Promise<CommunityPost> {
    const post = await this.communityRepository.findById(id);
    // Una publicación oculta solo la ven su autor y el personal
    if (!post || (post.isHidden() && !viewer.isStaff && post.authorId !== viewer.id)) {
      throw notFound(id);
    }
    return post;
  }

  async deletePost(id: string, actor: Actor): Promise<void> {
    const post = await this.getPost(id, actor);
    if (!actor.isStaff && post.authorId !== actor.id) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Solo el autor o el personal pueden eliminarla.' });
    }
    await this.communityRepository.delete(id);
    await this.media.deleteByPath(post.imageUrl).catch((error) => {
      // La publicación ya no existe: una imagen huérfana no justifica informar un fallo
      this.logger.error(`No se pudo borrar la imagen de ${id}: ${error.message}`);
    });
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; totalLikes: number }> {
    const post = await this.communityRepository.toggleLike(postId, userId);
    if (!post) throw notFound(postId);
    return { liked: post.likes.includes(userId), totalLikes: post.likes.length };
  }

  async addComment(postId: string, dto: AddCommentDto): Promise<PostComment> {
    const content = requireText(dto.content, 'comentario', MAX_COMMENT);
    const post = await this.communityRepository.findById(postId);
    if (!post || post.isHidden()) throw notFound(postId);

    if (dto.parentId) {
      const depth = post.depthOfReplyTo(dto.parentId);
      if (depth === null) {
        throw new UnprocessableEntityException({ code: 'PARENT_NOT_FOUND', message: 'El comentario que responde ya no existe.' });
      }
      if (depth > MAX_COMMENT_DEPTH) {
        throw new UnprocessableEntityException({ code: 'MAX_DEPTH', message: 'No se puede responder a más de tres niveles.' });
      }
    }

    const comment = new PostComment({
      id: randomUUID(),
      parentId: dto.parentId ?? null,
      authorId: dto.authorId,
      authorName: dto.authorName,
      content,
    });
    if (!(await this.communityRepository.pushComment(postId, comment))) throw notFound(postId);
    return comment;
  }

  async deleteComment(postId: string, commentId: string, actor: Actor): Promise<void> {
    const post = await this.getPost(postId, actor);
    const comment = post.comments.find((candidate) => candidate.id === commentId);
    if (!comment) {
      throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', message: 'Comentario no encontrado.' });
    }
    if (!actor.isStaff && comment.authorId !== actor.id) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Solo el autor o el personal pueden eliminarlo.' });
    }
    await this.communityRepository.markCommentDeleted(postId, commentId);
  }

  async reportPost(postId: string, userId: string, reason: string): Promise<void> {
    const text = requireText(reason, 'motivo', MAX_REASON);
    const post = await this.communityRepository.findById(postId);
    if (!post || post.isHidden()) throw notFound(postId);
    if (post.authorId === userId) {
      throw new UnprocessableEntityException({ code: 'OWN_POST', message: 'No puede denunciar su propia publicación.' });
    }
    if (!(await this.communityRepository.addReport(postId, { userId, reason: text, createdAt: new Date() }))) {
      throw new ConflictException({ code: 'ALREADY_REPORTED', message: 'Ya denunció esta publicación.' });
    }
  }

  async getModerationQueue(): Promise<CommunityPost[]> {
    return this.communityRepository.findModerationQueue();
  }

  async hidePost(postId: string, reason: string): Promise<CommunityPost> {
    const text = requireText(reason, 'motivo', MAX_REASON);
    const post = await this.communityRepository.hide(postId, text);
    if (!post) throw notFound(postId);
    await this.events.publish('community.post.hidden', {
      postId: post.id,
      authorId: post.authorId,
      title: post.title,
      reason: text,
    });
    return post;
  }

  async restorePost(postId: string): Promise<CommunityPost> {
    const post = await this.communityRepository.restore(postId);
    if (!post) throw notFound(postId);
    return post;
  }
}
