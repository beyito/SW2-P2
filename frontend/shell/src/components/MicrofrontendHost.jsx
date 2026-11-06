import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Calendar, LayoutDashboard, RefreshCw } from 'lucide-react';

// Contratos de integración de los tres microfrontends
const MFE_CONFIGS = {
  'estudio-ia': {
    title: 'Estudio IA & Comunidad',
    framework: 'React 18',
    badgeColor: '#61DAFB',
    textColor: '#0A0E17',
    origin: import.meta.env.VITE_MFE_ESTUDIO_URL || 'http://localhost:3001',
    domain: 'Diagnóstico capilar y facial, clóset virtual y comunidad.',
    icon: Sparkles,
  },
  reservas: {
    title: 'Reservas',
    framework: 'Vue.js 3',
    badgeColor: '#42B883',
    textColor: '#0A0E17',
    origin: import.meta.env.VITE_MFE_RESERVAS_URL || 'http://localhost:3002',
    domain: 'Agendamiento de citas y pago.',
    icon: Calendar,
  },
  gestion: {
    title: 'Gestión Operativa & ERP',
    framework: 'Angular 21',
    badgeColor: '#DD0031',
    textColor: '#FFFFFF',
    origin: import.meta.env.VITE_MFE_GESTION_URL || 'http://localhost:3003',
    domain: 'Inventario, agenda, estilistas, clientes, moderación y agente MCP.',
    icon: LayoutDashboard,
  },
};

export default function MicrofrontendHost({ activeTab, currentUser, token, onSessionLost }) {
  const [reloadKey, setReloadKey] = useState(0);
  const frame = useRef(null);
  const config = MFE_CONFIGS[activeTab] ?? MFE_CONFIGS['estudio-ia'];
  const IconComponent = config.icon;

  // Entrega el token solo al origen del microfrontend activo; nunca con destino "*"
  const sendToken = () => {
    frame.current?.contentWindow?.postMessage({ type: 'SALON_AUTH', token }, config.origin);
  };

  // Protocolo con el microfrontend: READY pide el token y UNAUTHORIZED avisa de una sesión terminada
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== config.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'SALON_READY') sendToken();
      if (event.data?.type === 'SALON_UNAUTHORIZED') onSessionLost();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  // Reenvía el token cada vez que se renueva
  useEffect(sendToken, [token]);

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '0 24px' }}>
      <div className="glass-panel" style={{ padding: '16px 24px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(212, 175, 55, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-glass)' }}>
            <IconComponent size={20} color="var(--gold-primary)" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }} className="gold-gradient-text">{config.title}</h2>
              <span style={{ background: config.badgeColor, color: config.textColor, fontSize: '0.72rem', fontWeight: 800, padding: '3px 8px', borderRadius: '6px' }}>
                {config.framework}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{config.domain}</p>
          </div>
        </div>

        <button
          onClick={() => setReloadKey((key) => key + 1)}
          className="btn-outline"
          style={{ padding: '8px 12px', fontSize: '0.75rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Recargar microfrontend"
        >
          <RefreshCw size={13} />
          Recargar
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '12px', borderRadius: '16px', overflow: 'hidden', minHeight: '700px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: 'rgba(0, 0, 0, 0.4)', borderRadius: '10px', padding: '8px 16px', marginBottom: '10px', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
          Sesión de <strong style={{ color: 'var(--gold-primary)' }}>{currentUser.name} ({currentUser.role})</strong>
        </div>

        <div style={{ flex: 1, position: 'relative', minHeight: '660px', borderRadius: '10px', overflow: 'hidden' }}>
          <iframe
            ref={frame}
            key={`${activeTab}-${reloadKey}`}
            id="mfe-frame"
            src={`${config.origin}/`}
            title={config.title}
            style={{ width: '100%', height: '660px', border: 'none', borderRadius: '10px', backgroundColor: '#0A0E17' }}
          />
        </div>
      </div>
    </div>
  );
}
