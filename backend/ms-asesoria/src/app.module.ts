import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClosetController } from './adapters/inbound/rest/closet.controller';
import { CommunityController } from './adapters/inbound/rest/community.controller';
import { ClosetService } from './adapters/inbound/services/closet.service';
import { CommunityService } from './adapters/inbound/services/community.service';
import { MongoClosetRepository } from './adapters/outbound/persistence/mongo-closet.repository';
import { MongoCommunityRepository } from './adapters/outbound/persistence/mongo-community.repository';
import {
  ClosetItemMongo,
  ClosetItemSchema,
} from './adapters/outbound/persistence/schemas/closet-item.schema';
import {
  CommunityPostMongo,
  CommunityPostSchema,
} from './adapters/outbound/persistence/schemas/community-post.schema';
import { CLOSET_USE_CASE } from './ports/inbound/closet.use-case.port';
import { COMMUNITY_USE_CASE } from './ports/inbound/community.use-case.port';
import { CLOSET_REPOSITORY } from './ports/outbound/closet-repository.port';
import { COMMUNITY_REPOSITORY } from './ports/outbound/community-repository.port';
import { AuthController } from './adapters/inbound/rest/auth.controller';
import { HealthController } from './adapters/inbound/rest/health.controller';
import { DynamoHttpClient } from './adapters/outbound/dynamo/dynamo-http.client';
import { DynamoSessionRegistry } from './adapters/outbound/dynamo/dynamo-session.registry';
import { SESSION_REGISTRY } from './ports/outbound/session-registry.port';
import { AuthGuard } from './common/security/auth.guard';
import { KeycloakTokenVerifier, TOKEN_VERIFIER } from './common/security/token-verifier';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://mongo_admin:mongo_secret_pass@localhost:27017/salon_asesoria?authSource=admin';

@Module({
  imports: [
    MongooseModule.forRoot(MONGO_URI),
    MongooseModule.forFeature([
      { name: ClosetItemMongo.name, schema: ClosetItemSchema },
      { name: CommunityPostMongo.name, schema: CommunityPostSchema },
    ]),
  ],
  controllers: [ClosetController, CommunityController, AuthController, HealthController],
  providers: [
    DynamoHttpClient,
    { provide: SESSION_REGISTRY, useClass: DynamoSessionRegistry },
    { provide: TOKEN_VERIFIER, useClass: KeycloakTokenVerifier },
    // Toda ruta exige un token válido salvo las marcadas con @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    {
      provide: CLOSET_USE_CASE,
      useClass: ClosetService,
    },
    {
      provide: COMMUNITY_USE_CASE,
      useClass: CommunityService,
    },
    {
      provide: CLOSET_REPOSITORY,
      useClass: MongoClosetRepository,
    },
    {
      provide: COMMUNITY_REPOSITORY,
      useClass: MongoCommunityRepository,
    },
  ],
})
export class AppModule {}
