import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { Connection, Model } from 'mongoose';
import { BiometricConsent } from '../../../domain/entities/biometric-consent.entity';
import { BiometricDiagnosis } from '../../../domain/entities/biometric-diagnosis.entity';
import { CommunityPost, PostComment } from '../../../domain/entities/community-post.entity';
import { MongoBiometricsRepository } from './mongo-biometrics.repository';
import { MongoCommunityRepository } from './mongo-community.repository';
import {
  BiometricConsentDocument,
  BiometricConsentMongo,
  BiometricConsentSchema,
  BiometricDiagnosisDocument,
  BiometricDiagnosisMongo,
  BiometricDiagnosisSchema,
} from './schemas/biometrics.schema';
import { CommunityPostMongo, CommunityPostSchema } from './schemas/community-post.schema';

jest.setTimeout(180_000);

/** Repositorios sobre un MongoDB real en un contenedor propio: índices, TTL y operaciones atómicas. */
describe('Persistencia en MongoDB', () => {
  let container: StartedMongoDBContainer;
  let connection: Connection;
  let biometrics: MongoBiometricsRepository;
  let community: MongoCommunityRepository;
  let diagnoses: Model<BiometricDiagnosisDocument>;

  const diagnosis = (clientId: string, id: string, createdAt = new Date()) =>
    new BiometricDiagnosis({
      id,
      clientId,
      source: 'IMAGE',
      faceShape: 'OVAL',
      faceShapeConfidence: 0.7,
      skinUndertone: 'WARM',
      undertoneConfidence: 0.6,
      recommendedPalette: ['Miel'],
      hairType: null,
      hairTypeConfidence: null,
      hairTone: null,
      framesAnalyzed: 1,
      method: 'prueba',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });

  const post = (id: string) =>
    new CommunityPost({ id, authorId: 'cli-1', authorName: 'Ana', title: 'Look', description: 'Texto', imageUrl: '/media/x' });

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7.0').start();
    connection = await mongoose.createConnection(`${container.getConnectionString()}/salon?directConnection=true`).asPromise();
    const consents = connection.model(BiometricConsentMongo.name, BiometricConsentSchema) as unknown as Model<BiometricConsentDocument>;
    diagnoses = connection.model(BiometricDiagnosisMongo.name, BiometricDiagnosisSchema) as unknown as Model<BiometricDiagnosisDocument>;
    const posts = connection.model(CommunityPostMongo.name, CommunityPostSchema) as any;
    await Promise.all([consents.init(), diagnoses.init(), posts.init()]);
    biometrics = new MongoBiometricsRepository(consents, diagnoses);
    community = new MongoCommunityRepository(posts);
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  describe('datos biométricos', () => {
    it('crea el índice que borra los resultados vencidos', async () => {
      const indexes = await diagnoses.collection.indexes();
      const ttl = indexes.find((index) => index.key.expiresAt === 1);
      expect(ttl?.expireAfterSeconds).toBe(0);
    });

    it('el consentimiento conserva su fecha de revocación al leerlo', async () => {
      const revokedAt = new Date();
      await biometrics.saveConsent(new BiometricConsent({ clientId: 'c1', policyVersion: 'v', grantedAt: new Date(), revokedAt }));
      const saved = await biometrics.findConsent('c1');
      expect(saved?.revokedAt?.getTime()).toBe(revokedAt.getTime());
      expect(saved?.isActive('v')).toBe(false);
    });

    it('guardar de nuevo reemplaza el consentimiento sin duplicarlo', async () => {
      await biometrics.saveConsent(new BiometricConsent({ clientId: 'c2', policyVersion: 'v1', grantedAt: new Date() }));
      await biometrics.saveConsent(new BiometricConsent({ clientId: 'c2', policyVersion: 'v2', grantedAt: new Date() }));
      expect((await biometrics.findConsent('c2'))?.policyVersion).toBe('v2');
    });

    it('lista del más reciente al más antiguo, solo del cliente', async () => {
      await biometrics.saveDiagnosis(diagnosis('c3', 'd1', new Date('2030-01-01')));
      await biometrics.saveDiagnosis(diagnosis('c3', 'd2', new Date('2030-01-02')));
      await biometrics.saveDiagnosis(diagnosis('otro', 'd3'));
      expect((await biometrics.findDiagnoses('c3')).map((item) => item.id)).toEqual(['d2', 'd1']);
    });

    it('un cliente no puede borrar el resultado de otro', async () => {
      await biometrics.saveDiagnosis(diagnosis('c4', 'd4'));
      expect(await biometrics.deleteDiagnosis('intruso', 'd4')).toBe(false);
      expect(await biometrics.deleteDiagnosis('c4', 'd4')).toBe(true);
    });

    it('borrar todo solo afecta al cliente', async () => {
      await biometrics.saveDiagnosis(diagnosis('c5', 'd5'));
      await biometrics.saveDiagnosis(diagnosis('c5', 'd6'));
      await biometrics.saveDiagnosis(diagnosis('c6', 'd7'));
      expect(await biometrics.deleteDiagnoses('c5')).toBe(2);
      expect(await biometrics.findDiagnoses('c6')).toHaveLength(1);
    });
  });

  describe('comunidad', () => {
    it('doce likes simultáneos del mismo usuario quedan en un estado coherente', async () => {
      await community.create(post('p1'));
      await Promise.all(Array.from({ length: 12 }, () => community.toggleLike('p1', 'u1')));
      const saved = await community.findById('p1');
      // Son 12 alternancias: un número par deja la publicación sin ese like, nunca con likes repetidos
      expect(saved?.likes.filter((user) => user === 'u1')).toHaveLength(0);
    });

    it('likes simultáneos de usuarios distintos no se pierden', async () => {
      await community.create(post('p2'));
      await Promise.all(Array.from({ length: 12 }, (_, n) => community.toggleLike('p2', `u${n}`)));
      expect((await community.findById('p2'))?.likes).toHaveLength(12);
    });

    it('no admite una respuesta a un comentario que no existe', async () => {
      await community.create(post('p3'));
      const reply = new PostComment({ id: 'c', parentId: 'no-existe', authorId: 'u', authorName: 'U', content: 'hola' });
      expect(await community.pushComment('p3', reply)).toBe(false);
    });

    it('un usuario solo puede denunciar una vez', async () => {
      await community.create(post('p4'));
      const report = { userId: 'u', reason: 'spam', createdAt: new Date() };
      expect(await community.addReport('p4', report)).toBe(true);
      expect(await community.addReport('p4', report)).toBe(false);
    });

    it('una publicación oculta sale del muro de los demás pero no del de su autor', async () => {
      await community.create(post('p5'));
      await community.hide('p5', 'moderación');
      expect((await community.findWall('otro')).map((item) => item.id)).not.toContain('p5');
      expect((await community.findWall('cli-1')).map((item) => item.id)).toContain('p5');
    });
  });
});
