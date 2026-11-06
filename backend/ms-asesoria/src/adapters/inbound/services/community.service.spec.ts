import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CommunityService } from './community.service';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';

const IMAGE = `/media/${'a'.repeat(32)}`;
const AUTHOR = { id: 'user-01', isStaff: false };
const OTHER = { id: 'user-02', isStaff: false };
const STAFF = { id: 'sty-1', isStaff: true };

describe('CommunityService (CU-20: Muro Social, CU-21: Reacciones y Comentarios)', () => {
  let service: CommunityService;
  let repository: any;
  let events: { publish: jest.Mock };
  let media: { deleteByPath: jest.Mock };
  let post: CommunityPost;

  beforeEach(() => {
    post = new CommunityPost({
      id: 'post-100',
      authorId: AUTHOR.id,
      authorName: 'Camila',
      title: 'Mi look',
      description: 'Balayage',
      imageUrl: IMAGE,
      comments: [new PostComment({ id: 'c1', authorId: OTHER.id, authorName: 'Andrea', content: 'Lindo' })],
    });
    repository = {
      create: jest.fn().mockImplementation((value) => Promise.resolve(value)),
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve(id === post.id ? post : null)),
      findWall: jest.fn().mockResolvedValue([post]),
      delete: jest.fn().mockResolvedValue(true),
      toggleLike: jest.fn(),
      pushComment: jest.fn().mockResolvedValue(true),
      markCommentDeleted: jest.fn().mockResolvedValue(true),
      addReport: jest.fn().mockResolvedValue(true),
      findModerationQueue: jest.fn().mockResolvedValue([post]),
      hide: jest.fn().mockImplementation((_, reason) => {
        post.status = 'HIDDEN';
        post.moderationReason = reason;
        return Promise.resolve(post);
      }),
      restore: jest.fn().mockResolvedValue(post),
    };
    events = { publish: jest.fn().mockResolvedValue(undefined) };
    media = { deleteByPath: jest.fn().mockResolvedValue(undefined) };
    service = new CommunityService(repository, events, media as any);
  });

  const newPost = (changes = {}) => ({
    authorId: AUTHOR.id,
    authorName: 'Camila',
    title: ' Keratina ',
    description: 'Brillo',
    imageUrl: IMAGE,
    ...changes,
  });

  describe('publicar (CU-20)', () => {
    it('crea la publicación con su imagen subida', async () => {
      const created = await service.createPost(newPost());

      expect(created.title).toBe('Keratina');
      expect(created.status).toBe('VISIBLE');
      expect(created.likes).toEqual([]);
    });

    it('rechaza una imagen externa o ausente', async () => {
      await expect(service.createPost(newPost({ imageUrl: 'https://evil.example/x.jpg' }))).rejects.toThrow(BadRequestException);
      await expect(service.createPost(newPost({ imageUrl: undefined }))).rejects.toThrow(BadRequestException);
    });

    it('rechaza un título vacío o demasiado largo', async () => {
      await expect(service.createPost(newPost({ title: '   ' }))).rejects.toThrow(BadRequestException);
      await expect(service.createPost(newPost({ title: 'x'.repeat(121) }))).rejects.toThrow(BadRequestException);
    });

    it('solo el autor o el personal pueden eliminarla, y se borra su imagen', async () => {
      await expect(service.deletePost(post.id, OTHER)).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();

      await service.deletePost(post.id, STAFF);
      expect(repository.delete).toHaveBeenCalledWith(post.id);
      expect(media.deleteByPath).toHaveBeenCalledWith(IMAGE);
    });
  });

  describe('reaccionar y comentar (CU-21)', () => {
    it('informa el estado del like que devolvió la operación atómica', async () => {
      repository.toggleLike.mockResolvedValue(new CommunityPost({ likes: ['user-05', 'user-06'] }));

      await expect(service.toggleLike(post.id, 'user-05')).resolves.toEqual({ liked: true, totalLikes: 2 });
      await expect(service.toggleLike(post.id, 'user-09')).resolves.toEqual({ liked: false, totalLikes: 2 });
    });

    it('responde 404 al dar like a una publicación no disponible', async () => {
      repository.toggleLike.mockResolvedValue(null);

      await expect(service.toggleLike('nada', 'user-01')).rejects.toThrow(NotFoundException);
    });

    it('agrega una respuesta en cascada a un comentario existente', async () => {
      const reply = await service.addComment(post.id, {
        authorId: OTHER.id,
        authorName: 'Andrea',
        content: ' Gracias ',
        parentId: 'c1',
      });

      expect(reply.parentId).toBe('c1');
      expect(reply.content).toBe('Gracias');
      expect(repository.pushComment).toHaveBeenCalledWith(post.id, reply);
    });

    it('rechaza responder a un comentario inexistente o eliminado', async () => {
      const dto = { authorId: OTHER.id, authorName: 'Andrea', content: 'Hola' };
      await expect(service.addComment(post.id, { ...dto, parentId: 'nada' })).rejects.toThrow(UnprocessableEntityException);

      post.comments[0].deleted = true;
      await expect(service.addComment(post.id, { ...dto, parentId: 'c1' })).rejects.toThrow(UnprocessableEntityException);
    });

    it('limita la cascada a tres niveles', async () => {
      post.comments.push(
        new PostComment({ id: 'c2', parentId: 'c1', authorId: OTHER.id, authorName: 'A', content: 'n2' }),
        new PostComment({ id: 'c3', parentId: 'c2', authorId: OTHER.id, authorName: 'A', content: 'n3' }),
      );
      const dto = { authorId: OTHER.id, authorName: 'Andrea', content: 'Hola' };

      await expect(service.addComment(post.id, { ...dto, parentId: 'c2' })).resolves.toBeDefined();
      await expect(service.addComment(post.id, { ...dto, parentId: 'c3' })).rejects.toThrow(UnprocessableEntityException);
    });

    it('rechaza un comentario vacío', async () => {
      await expect(service.addComment(post.id, { authorId: 'u', authorName: 'U', content: '  ' })).rejects.toThrow(BadRequestException);
    });

    it('un comentario solo lo eliminan su autor o el personal', async () => {
      await expect(service.deleteComment(post.id, 'c1', AUTHOR)).rejects.toThrow(ForbiddenException);
      await service.deleteComment(post.id, 'c1', OTHER);
      expect(repository.markCommentDeleted).toHaveBeenCalledWith(post.id, 'c1');
    });
  });

  describe('moderación', () => {
    it('no permite denunciar la propia publicación ni hacerlo dos veces', async () => {
      await expect(service.reportPost(post.id, AUTHOR.id, 'Spam')).rejects.toThrow(UnprocessableEntityException);

      repository.addReport.mockResolvedValue(false);
      await expect(service.reportPost(post.id, OTHER.id, 'Spam')).rejects.toThrow(ConflictException);
    });

    it('exige un motivo para denunciar y para ocultar', async () => {
      await expect(service.reportPost(post.id, OTHER.id, ' ')).rejects.toThrow(BadRequestException);
      await expect(service.hidePost(post.id, '')).rejects.toThrow(BadRequestException);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('al ocultar publica el evento que avisa al autor', async () => {
      await service.hidePost(post.id, 'Contenido ofensivo');

      expect(events.publish).toHaveBeenCalledWith('community.post.hidden', {
        postId: post.id,
        authorId: AUTHOR.id,
        title: 'Mi look',
        reason: 'Contenido ofensivo',
      });
    });

    it('una publicación oculta solo la ven su autor y el personal', async () => {
      post.status = 'HIDDEN';

      await expect(service.getPost(post.id, OTHER)).rejects.toThrow(NotFoundException);
      await expect(service.getPost(post.id, AUTHOR)).resolves.toBe(post);
      await expect(service.getPost(post.id, STAFF)).resolves.toBe(post);
    });

    it('no admite comentarios ni denuncias sobre una publicación oculta', async () => {
      post.status = 'HIDDEN';

      await expect(service.addComment(post.id, { authorId: 'u', authorName: 'U', content: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.reportPost(post.id, OTHER.id, 'Spam')).rejects.toThrow(NotFoundException);
    });
  });
});
