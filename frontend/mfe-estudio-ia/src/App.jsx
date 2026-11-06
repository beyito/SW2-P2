import React, { useState } from 'react';
import { Camera, Sparkles, RefreshCw } from 'lucide-react';
import { authFetch } from './auth';
import Closet from './components/Closet';
import Community from './components/Community';

export default function App() {
  const [activeTab, setActiveTab] = useState('biometrics'); // biometrics | closet | community
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [recommendations, setRecommendations] = useState([]);

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

      {activeTab === 'closet' && <Closet />}
      {activeTab === 'community' && <Community />}
    </div>
  );
}
