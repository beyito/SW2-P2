// ====================================================================
// Script idempotente de Colecciones e Índices en MongoDB
// Base de Datos: salon_asesoria (ms-asesoria)
// Puede ejecutarse en cada arranque sin duplicar datos.
// ====================================================================

const salonDb = db.getSiblingDB('salon_asesoria');
const existentes = salonDb.getCollectionNames();

// Crea la colección únicamente si todavía no existe
function asegurarColeccion(nombre) {
  if (!existentes.includes(nombre)) {
    salonDb.createCollection(nombre);
  }
}

// 1. Colección: virtual_closet_items (CU-15)
asegurarColeccion('virtual_closet_items');
salonDb.virtual_closet_items.createIndex({ clientId: 1 }, { name: 'idx_closet_clientId' });
salonDb.virtual_closet_items.createIndex({ category: 1 }, { name: 'idx_closet_category' });
salonDb.virtual_closet_items.createIndex({ season: 1 }, { name: 'idx_closet_season' });

// 2. Colección: community_posts (CU-20, CU-21)
asegurarColeccion('community_posts');
salonDb.community_posts.createIndex({ createdAt: -1 }, { name: 'idx_posts_createdAt' });
salonDb.community_posts.createIndex({ authorId: 1 }, { name: 'idx_posts_authorId' });
salonDb.community_posts.createIndex({ likes: 1 }, { name: 'idx_posts_likes' });

// 3. Consentimiento y resultados biométricos (CU-13). Nunca guardan imágenes ni video.
asegurarColeccion('biometric_consents');
salonDb.biometric_consents.createIndex({ clientId: 1 }, { unique: true, name: 'clientId_1' });
asegurarColeccion('biometric_diagnoses');
salonDb.biometric_diagnoses.createIndex({ id: 1 }, { unique: true, name: 'id_1' });
salonDb.biometric_diagnoses.createIndex({ clientId: 1, createdAt: -1 }, { name: 'clientId_1_createdAt_-1' });
// Política de retención: MongoDB borra el documento al llegar a expiresAt
salonDb.biometric_diagnoses.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_1' });

// Datos semilla: se insertan solo si el documento no existe
salonDb.virtual_closet_items.updateOne(
  { id: 'item-seed-01' },
  {
    $setOnInsert: {
      id: 'item-seed-01',
      clientId: 'cli-001',
      name: 'Blazer Lino Beige Oversize',
      category: 'OUTERWEAR',
      color: 'Beige',
      season: 'SPRING',
      imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea',
      tags: ['formal', 'casual-chic', 'primavera'],
      createdAt: new Date(),
    },
  },
  { upsert: true },
);

salonDb.community_posts.updateOne(
  { id: 'post-seed-01' },
  {
    $setOnInsert: {
      id: 'post-seed-01',
      authorId: 'cli-001',
      authorName: 'Camila Fernandez',
      title: 'Mi cambio a Balayage Caramelo',
      description: 'Encantada con el resultado del corte y color en el salón. ¡Totalmente recomendado!',
      imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e',
      likes: ['cli-002'],
      comments: [
        {
          id: 'comm-01',
          authorId: 'cli-002',
          authorName: 'Alejandro Morales',
          content: '¡Gran estilo! Te queda excelente.',
          createdAt: new Date(),
        },
      ],
      createdAt: new Date(),
    },
  },
  { upsert: true },
);

print('Colecciones e índices de salon_asesoria verificados.');
