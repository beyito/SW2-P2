import React, { useState } from 'react';
import { Camera, Sparkles, Heart, MessageCircle, Shirt, RefreshCw, CheckCircle, Tag } from 'lucide-react';
import { authFetch } from './auth';

export default function App() {
  const [activeTab, setActiveTab] = useState('biometrics'); // biometrics | closet | community
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [recommendations, setRecommendations] = useState([]);

  // Closet
  const [closetItems, setClosetItems] = useState([
    { id: 'c1', name: 'Blazer Lino Beige', category: 'OUTERWEAR', color: 'Beige', season: 'SPRING', imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400' },
    { id: 'c2', name: 'Vestido Seda Esmeralda', category: 'OUTERWEAR', color: 'Verde Esmeralda', season: 'SUMMER', imageUrl: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400' }
  ]);
  const [newItem, setNewItem] = useState({ name: '', category: 'OUTERWEAR', color: '', season: 'SPRING' });

  // Community
  const [posts, setPosts] = useState([
    {
      id: 'p1',
      author: 'Camila Fernandez',
      title: 'Balayage Miel & Avellana ✨',
      desc: 'Resultado después del análisis biométrico capilar.',
      likes: 2,
      liked: false,
      comments: [
        { id: 'cm1', author: 'Valentina Rossi', text: 'Gran elección para tu subtono cálido.' }
      ]
    }
  ]);
  const [newComment, setNewComment] = useState('');

  const runBiometrics = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await authFetch('http://127.0.0.1:8002/api/v1/biometrics/scan', { method: 'POST' });
      if (!res.ok) {
        throw new Error(`El servicio de diagnóstico respondió ${res.status}.`);
      }
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);

        const recRes = await authFetch('http://127.0.0.1:8002/api/v1/recommendations/styles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            face_shape: data.face_shape,
            hair_type: data.hair_type,
            skin_undertone: data.skin_undertone
          })
        });
        if (recRes.ok) {
          const recData = await recRes.json();
          setRecommendations(recData);
        }
      }
    } catch (e) {
      // Nunca se muestra un diagnóstico inventado si el servicio no responde
      setScanError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const toggleLike = (id) => {
    setPosts(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 };
      }
      return p;
    }));
  };

  const addComment = (id) => {
    if (!newComment.trim()) return;
    setPosts(prev => prev.map(p => {
      if (p.id === id) {
        return {
          ...p,
          comments: [...p.comments, { id: 'c-' + Date.now(), author: 'Camila Fernandez', text: newComment }]
        };
      }
      return p;
    }));
    setNewComment('');
  };

  const addPrenda = (e) => {
    e.preventDefault();
    if (!newItem.name || !newItem.color) return;
    setClosetItems(prev => [
      { id: 'c-' + Date.now(), ...newItem, imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400' },
      ...prev
    ]);
    setNewItem({ name: '', category: 'OUTERWEAR', color: '', season: 'SPRING' });
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      {/* Header React Component */}
      <header className="glass-panel" style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#61DAFB', color: '#0A0E17', fontWeight: 800, padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem' }}>
            React 18
          </div>
          <div>
            <h2 className="gold-gradient-text" style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
              MFE Estudio IA & Comunidad
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Componente Autónomo React (Module Federation / Remote)
            </span>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setActiveTab('biometrics')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: activeTab === 'biometrics' ? 'linear-gradient(135deg, #F5D061, #D4AF37)' : 'transparent',
              color: activeTab === 'biometrics' ? '#0A0E17' : 'var(--text-secondary)'
            }}
          >
            Escáner Biométrico (CU-13)
          </button>
          <button
            onClick={() => setActiveTab('closet')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: activeTab === 'closet' ? 'linear-gradient(135deg, #F5D061, #D4AF37)' : 'transparent',
              color: activeTab === 'closet' ? '#0A0E17' : 'var(--text-secondary)'
            }}
          >
            Clóset Virtual (CU-15)
          </button>
          <button
            onClick={() => setActiveTab('community')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: activeTab === 'community' ? 'linear-gradient(135deg, #F5D061, #D4AF37)' : 'transparent',
              color: activeTab === 'community' ? '#0A0E17' : 'var(--text-secondary)'
            }}
          >
            Comunidad Social (CU-20)
          </button>
        </nav>
      </header>

      {/* TAB 1: BIOMETRICS */}
      {activeTab === 'biometrics' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 className="gold-gradient-text" style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
              Diagnóstico Biométrico Facial y Capilar
            </h3>
            <div style={{ background: '#06090F', borderRadius: '12px', padding: '36px 20px', textAlign: 'center', border: '1px dashed var(--border-glass)', marginBottom: '18px' }}>
              <Camera size={44} color="var(--gold-primary)" style={{ marginBottom: '10px' }} />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Alinea tu rostro dentro del visor para análisis capilar y antropométrico
              </p>
            </div>

            <button
              onClick={runBiometrics}
              disabled={scanning}
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #F5D061, #D4AF37)',
                color: '#0A0E17',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {scanning ? <RefreshCw size={16} className="spin-slow" /> : <Sparkles size={16} />}
              {scanning ? 'Procesando Tensores...' : 'Iniciar Escaneo Biométrico (ms-ia)'}
            </button>

            {scanError && (
              <p id="scan-error" style={{ color: '#FCA5A5', fontSize: '0.85rem' }}>{scanError}</p>
            )}

            {scanResult && (
              <div style={{ marginTop: '18px', padding: '16px', background: 'rgba(212, 175, 55, 0.08)', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
                <div style={{ fontWeight: 700, color: 'var(--gold-primary)', marginBottom: '8px', fontSize: '0.9rem' }}>Diagnóstico Obtenido:</div>
                <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>Morfología: <strong>{scanResult.face_shape}</strong></div>
                  <div>Textura: <strong>{scanResult.hair_type}</strong></div>
                  <div>Subtono: <strong>{scanResult.skin_undertone}</strong></div>
                  <div>Confianza: <strong style={{ color: '#42B883' }}>{Math.round(scanResult.confidence_face * 100)}%</strong></div>
                </div>
              </div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 className="gold-gradient-text" style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
              Recomendaciones de Estilo Personalizadas (CU-14)
            </h3>
            {recommendations.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', fontSize: '0.9rem' }}>
                Ejecuta el escaneo biométrico para calcular la afinidad geométrica y colorimétrica.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recommendations.map((rec, idx) => (
                  <div key={idx} style={{ padding: '16px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{rec.style_name}</span>
                      <span style={{ color: 'var(--gold-primary)', fontWeight: 800 }}>{Math.round(rec.match_score * 100)}% Match</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>{rec.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CLOSET */}
      {activeTab === 'closet' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 className="gold-gradient-text" style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
              Armario Virtual Inteligente (CU-15)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {closetItems.map(item => (
                <div key={item.id} style={{ borderRadius: '10px', overflow: 'hidden', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-glass)' }}>
                  <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                  <div style={{ padding: '12px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{item.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {item.category} • {item.color} • {item.season}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 className="gold-gradient-text" style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
              Agregar Prenda al Clóset
            </h3>
            <form onSubmit={addPrenda} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input
                type="text"
                placeholder="Nombre de la prenda"
                value={newItem.name}
                onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                style={{ width: '100%', padding: '12px', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-glass)', color: '#fff', borderRadius: '8px' }}
              />
              <input
                type="text"
                placeholder="Color (ej: Verde Esmeralda)"
                value={newItem.color}
                onChange={e => setNewItem({ ...newItem, color: e.target.value })}
                style={{ width: '100%', padding: '12px', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-glass)', color: '#fff', borderRadius: '8px' }}
              />
              <button
                type="submit"
                style={{ padding: '12px', background: 'linear-gradient(135deg, #F5D061, #D4AF37)', color: '#0A0E17', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                Guardar en MongoDB
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: COMMUNITY */}
      {activeTab === 'community' && (
        <div className="glass-panel" style={{ padding: '24px', maxWidth: '700px', margin: '0 auto' }}>
          <h3 className="gold-gradient-text" style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
            Muro de Comunidad Social (CU-20, CU-21)
          </h3>
          {posts.map(post => (
            <div key={post.id} style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '18px', borderRadius: '12px', border: '1px solid var(--border-glass)', marginBottom: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '4px' }}>{post.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Por {post.author}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 14px' }}>{post.desc}</p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderTop: '1px solid var(--border-glass)', paddingTop: '10px' }}>
                <button
                  onClick={() => toggleLike(post.id)}
                  style={{ background: 'none', border: 'none', color: post.liked ? 'var(--crimson-alert)' : 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                >
                  <Heart size={16} fill={post.liked ? 'var(--crimson-alert)' : 'none'} />
                  {post.likes} Likes
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageCircle size={16} />
                  {post.comments.length} Comentarios
                </span>
              </div>

              {/* Comentarios */}
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {post.comments.map(c => (
                  <div key={c.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem' }}>
                    <strong>{c.author}:</strong> {c.text}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <input
                  type="text"
                  placeholder="Escribe un comentario..."
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-glass)', color: '#fff', borderRadius: '6px', fontSize: '0.8rem' }}
                />
                <button
                  onClick={() => addComment(post.id)}
                  style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #F5D061, #D4AF37)', color: '#0A0E17', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Publicar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
