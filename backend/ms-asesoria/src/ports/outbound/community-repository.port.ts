import { CommunityPost } from '../../domain/entities/community-post.entity';

export interface ICommunityRepository {
  save(post: CommunityPost): Promise<CommunityPost>;
  findAll(): Promise<CommunityPost[]>;
  findById(id: string): Promise<CommunityPost | null>;
}

export const COMMUNITY_REPOSITORY = Symbol('ICommunityRepository');
