import { Controller, Post, Get, Body, Param, Inject, NotFoundException } from '@nestjs/common';
import {
  ICommunityUseCase,
  COMMUNITY_USE_CASE,
  CreatePostDto,
  AddCommentDto,
} from '../../../ports/inbound/community.use-case.port';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';
import { AuthenticatedUser, CurrentUser } from '../../../common/security/auth.decorators';

@Controller('community')
export class CommunityController {
  constructor(
    @Inject(COMMUNITY_USE_CASE)
    private readonly communityUseCase: ICommunityUseCase,
  ) {}

  // El autor siempre sale del token: nadie puede publicar en nombre de otra persona
  @Post()
  async createPost(@Body() dto: CreatePostDto, @CurrentUser() user: AuthenticatedUser): Promise<CommunityPost> {
    return this.communityUseCase.createPost({ ...dto, authorId: user.id, authorName: user.name });
  }

  @Get()
  async getAll(): Promise<CommunityPost[]> {
    return this.communityUseCase.getAllPosts();
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<CommunityPost> {
    const post = await this.communityUseCase.getPostById(id);
    if (!post) {
      throw new NotFoundException(`Publicación no encontrada con ID: ${id}`);
    }
    return post;
  }

  @Post(':id/like')
  async toggleLike(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ liked: boolean; totalLikes: number }> {
    return this.communityUseCase.toggleLike(id, user.id);
  }

  @Post(':id/comment')
  async addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostComment> {
    return this.communityUseCase.addComment(id, { ...dto, authorId: user.id, authorName: user.name });
  }
}
