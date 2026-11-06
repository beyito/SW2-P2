import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ICommunityUseCase, COMMUNITY_USE_CASE, Actor } from '../../../ports/inbound/community.use-case.port';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';
import { AuthenticatedUser, CurrentUser, isStaff, Roles } from '../../../common/security/auth.decorators';

const actorOf = (user: AuthenticatedUser): Actor => ({ id: user.id, isStaff: isStaff(user) });

/** Lo que un cliente puede ver: nunca la lista de quién dio like ni quién denunció. */
function commentView(comment: PostComment) {
  return {
    id: comment.id,
    parentId: comment.parentId ?? null,
    authorId: comment.deleted ? null : comment.authorId,
    authorName: comment.deleted ? null : comment.authorName,
    content: comment.deleted ? null : comment.content,
    deleted: comment.deleted,
    createdAt: comment.createdAt,
  };
}

function postView(post: CommunityPost, viewer: AuthenticatedUser) {
  const canModerate = isStaff(viewer);
  const canSeeModeration = canModerate || post.authorId === viewer.id;
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    title: post.title,
    description: post.description,
    imageUrl: post.imageUrl,
    totalLikes: post.likes.length,
    likedByMe: post.likes.includes(viewer.id),
    reportedByMe: post.reports.some((report) => report.userId === viewer.id),
    comments: post.comments.map(commentView),
    status: post.status,
    moderationReason: canSeeModeration ? post.moderationReason : null,
    reports: canModerate ? post.reports.map(({ reason, createdAt }) => ({ reason, createdAt })) : undefined,
    createdAt: post.createdAt,
  };
}

@Controller('community')
export class CommunityController {
  constructor(
    @Inject(COMMUNITY_USE_CASE)
    private readonly communityUseCase: ICommunityUseCase,
  ) {}

  // El autor siempre sale del token: nadie puede publicar en nombre de otra persona
  @Post()
  async createPost(@Body() dto: Record<string, string>, @CurrentUser() user: AuthenticatedUser) {
    const post = await this.communityUseCase.createPost({
      title: dto.title,
      description: dto.description,
      imageUrl: dto.imageUrl,
      authorId: user.id,
      authorName: user.name,
    });
    return postView(post, user);
  }

  @Get()
  async getAll(@CurrentUser() user: AuthenticatedUser) {
    const posts = await this.communityUseCase.getWall(actorOf(user));
    return posts.map((post) => postView(post, user));
  }

  // Debe declararse antes de ':id' para que no se interprete como un identificador
  @Roles('ADMIN', 'STYLIST')
  @Get('moderation/queue')
  async moderationQueue(@CurrentUser() user: AuthenticatedUser) {
    const posts = await this.communityUseCase.getModerationQueue();
    return posts.map((post) => postView(post, user));
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return postView(await this.communityUseCase.getPost(id, actorOf(user)), user);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<{ success: boolean }> {
    await this.communityUseCase.deletePost(id, actorOf(user));
    return { success: true };
  }

  @HttpCode(200)
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
    @Body() dto: Record<string, string>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const comment = await this.communityUseCase.addComment(id, {
      content: dto.content,
      parentId: dto.parentId,
      authorId: user.id,
      authorName: user.name,
    });
    return commentView(comment);
  }

  @Delete(':id/comment/:commentId')
  async deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    await this.communityUseCase.deleteComment(id, commentId, actorOf(user));
    return { success: true };
  }

  @Post(':id/report')
  async report(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    await this.communityUseCase.reportPost(id, user.id, reason);
    return { success: true };
  }

  @Roles('ADMIN', 'STYLIST')
  @HttpCode(200)
  @Post(':id/hide')
  async hide(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: AuthenticatedUser) {
    return postView(await this.communityUseCase.hidePost(id, reason), user);
  }

  @Roles('ADMIN', 'STYLIST')
  @HttpCode(200)
  @Post(':id/restore')
  async restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return postView(await this.communityUseCase.restorePost(id), user);
  }
}
