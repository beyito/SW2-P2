import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClosetController } from './adapters/inbound/rest/closet.controller';
import { MediaController } from './adapters/inbound/rest/media.controller';
import { BiometricsController } from './adapters/inbound/rest/biometrics.controller';
import { BiometricsService } from './adapters/inbound/services/biometrics.service';
import { MongoBiometricsRepository } from './adapters/outbound/persistence/mongo-biometrics.repository';
import {
  BiometricConsentMongo,
  BiometricConsentSchema,
  BiometricDiagnosisMongo,
  BiometricDiagnosisSchema,
} from './adapters/outbound/persistence/schemas/biometrics.schema';
import { BIOMETRICS_USE_CASE } from './ports/inbound/biometrics.use-case.port';
import { BIOMETRICS_REPOSITORY } from './ports/outbound/biometrics-repository.port';
import { CommunityController } from './adapters/inbound/rest/community.controller';
import { ClosetService } from './adapters/inbound/services/closet.service';
import { CommunityService } from './adapters/inbound/services/community.service';
import { MediaService } from './adapters/inbound/services/media.service';
import { RabbitEventPublisher } from './adapters/outbound/messaging/rabbit-event.publisher';
import { GridFsMediaStorage } from './adapters/outbound/persistence/gridfs-media.storage';
import { EVENT_PUBLISHER } from './ports/outbound/event-publisher.port';
import { MEDIA_STORAGE } from './ports/outbound/media-storage.port';
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
      { name: BiometricConsentMongo.name, schema: BiometricConsentSchema },
      { name: BiometricDiagnosisMongo.name, schema: BiometricDiagnosisSchema },
    ]),
  ],
  controllers: [ClosetController, CommunityController, MediaController, BiometricsController, AuthController, HealthController],
  providers: [
    DynamoHttpClient,
    MediaService,
    { provide: MEDIA_STORAGE, useClass: GridFsMediaStorage },
    { provide: EVENT_PUBLISHER, useClass: RabbitEventPublisher },
    { provide: SESSION_REGISTRY, useClass: DynamoSessionRegistry },
    { provide: TOKEN_VERIFIER, useClass: KeycloakTokenVerifier },
    // Toda ruta exige un token válido salvo las marcadas con @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: BIOMETRICS_USE_CASE, useClass: BiometricsService },
    { provide: BIOMETRICS_REPOSITORY, useClass: MongoBiometricsRepository },
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
