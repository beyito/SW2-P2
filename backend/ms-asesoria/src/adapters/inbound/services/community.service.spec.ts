import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CommunityService } from './community.service';
import { COMMUNITY_REPOSITORY } from '../../../ports/outbound/community-repository.port';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';

describe('CommunityService (CU-20: Muro Social, CU-21: Reacciones y Comentarios)', () => {
  let service: CommunityService;
  let mockRepository: any;
  let testPost: CommunityPost;

  beforeEach(async () => {
    testPost = new CommunityPost({
      id: 'post-100',
      authorId: 'user-01',
      authorName: 'Camila Fernandez',
      title: 'Mi cambio de look Balayage Dorado',
      description: 'Increíble trabajo de Valentina!',
      imageUrl: 'https://example.com/look.jpg',
      likes: ['user-02'],
      comments: [
        new PostComment({
          id: 'comm-1',
          authorId: 'user-03',
          authorName: 'Andrea Solis',
          content: '¡Te quedó hermoso!',
        }),
      ],
    });

    mockRepository = {
      save: jest.fn().mockImplementation((post) => Promise.resolve(post)),
      findAll: jest.fn().mockResolvedValue([testPost]),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === 'post-100') return Promise.resolve(testPost);
        return Promise.resolve(null);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        {
          provide: COMMUNITY_REPOSITORY,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CommunityService>(CommunityService);
  });

  it('debe crear una nueva publicación en el muro de comunidad (CU-20)', async () => {
    const dto = {
      authorId: 'user-01',
      authorName: 'Camila Fernandez',
      title: 'Tratamiento de Keratina',
      description: 'Brillo y suavidad 100%',
      imageUrl: 'https://example.com/keratina.jpg',
    };

    const post = await service.createPost(dto);

    expect(post).toBeDefined();
    expect(post.title).toBe('Tratamiento de Keratina');
    expect(post.likes).toEqual([]);
    expect(mockRepository.save).toHaveBeenCalledTimes(1);
  });

  it('debe alternar reacción like (toggle-like) correctamente (CU-21)', async () => {
    // El usuario 'user-05' no ha dado like todavía -> debe agregarlo
    const resAdd = await service.toggleLike('post-100', 'user-05');
    expect(resAdd.liked).toBe(true);
    expect(resAdd.totalLikes).toBe(2);

    // Si 'user-05' vuelve a llamar toggleLike -> debe removerlo
    const resRemove = await service.toggleLike('post-100', 'user-05');
    expect(resRemove.liked).toBe(false);
    expect(resRemove.totalLikes).toBe(1);
  });

  it('debe arrojar NotFoundException al dar like a un post inexistente', async () => {
    await expect(service.toggleLike('post-inexistente', 'user-01')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('debe agregar comentario en cascada a un post (CU-21)', async () => {
    const commentDto = {
      authorId: 'user-04',
      authorName: 'Sofía Morales',
      content: '¡Espectacular el corte!',
    };

    const comment = await service.addComment('post-100', commentDto);

    expect(comment).toBeDefined();
    expect(comment.content).toBe('¡Espectacular el corte!');
    expect(testPost.comments.length).toBe(2);
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
