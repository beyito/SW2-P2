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

// 3. Colección: styling_consultations (CU-13, CU-14)
asegurarColeccion('styling_consultations');
salonDb.styling_consultations.createIndex({ clientId: 1, createdAt: -1 }, { name: 'idx_consultations_client_date' });

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
