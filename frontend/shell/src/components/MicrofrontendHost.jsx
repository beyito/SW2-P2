import React, { useEffect, useRef, useState } from 'react';
import { visibleTabsFor } from '../tabs';
import { Sparkles, Calendar, LayoutDashboard, RefreshCw } from 'lucide-react';

// Contratos de integración de los tres microfrontends, cargados con Module Federation
const MFE_CONFIGS = {
  'estudio-ia': {
    title: 'Estudio IA & Comunidad',
    framework: 'React 18',
    badgeColor: '#61DAFB',
    textColor: '#0A0E17',
    load: () => import('mfe_estudio/mount'),
    domain: 'Diagnóstico capilar y facial, clóset virtual y comunidad.',
    icon: Sparkles,
  },
  reservas: {
    title: 'Reservas',
    framework: 'Vue.js 3',
    badgeColor: '#42B883',
    textColor: '#0A0E17',
    load: () => import('mfe_reservas/mount'),
    domain: 'Agendamiento de citas y pago.',
    icon: Calendar,
  },
  gestion: {
    title: 'Gestión Operativa & ERP',
    framework: 'Angular 21',
    badgeColor: '#DD0031',
    textColor: '#FFFFFF',
    load: () => import('mfe_gestion/mount'),
    domain: 'Inventario, agenda, estilistas, clientes, moderación y agente MCP.',
    icon: LayoutDashboard,
  },
};

const SERVICE_ID = /^[\w-]{1,36}$/;

export default function MicrofrontendHost({ activeTab, currentUser, getToken, onSessionLost, bookService, resumeSaga, onBook, offline }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const container = useRef(null);
  const config = MFE_CONFIGS[activeTab] ?? MFE_CONFIGS['estudio-ia'];
  const IconComponent = config.icon;
  // Se leen desde una referencia para que un nuevo render del Shell no vuelva a montar el microfrontend
  const callbacks = useRef();
  callbacks.current = { getToken, onSessionLost, onBook };

  // Se precargan los demás módulos: sin conexión ya no se podrían traer al cambiar de pestaña
  const canManage = currentUser.role !== 'CLIENT';
  useEffect(() => {
    Object.entries(MFE_CONFIGS)
      // Solo se precargan los módulos que este rol puede abrir
      .filter(([tab]) => visibleTabsFor(currentUser.role, canManage).some((visible) => visible.id === tab))
      .forEach(([, remote]) => remote.load().catch(() => {}));
  }, [canManage, currentUser.role]);

  // Un microfrontend que no carga solo afecta a su pestaña: el Shell y los demás siguen funcionando
  useEffect(() => {
    let cancelled = false;
    let unmount = null;
    const element = document.createElement('div');
    element.id = 'mfe-root';
    container.current.append(element);
    setLoadError(false);

    (async () => {
      try {
        const remote = await config.load();
        if (cancelled) return;
        const dispose = await remote.mount(element, {
          getToken: () => callbacks.current.getToken(),
          onSessionLost: () => callbacks.current.onSessionLost(),
          onBook: (serviceId) => {
            if (SERVICE_ID.test(serviceId ?? '')) callbacks.current.onBook(serviceId);
          },
          params: activeTab === 'reservas' ? { service: bookService, saga: resumeSaga } : {},
          offline,
        });
        if (cancelled) dispose();
        else unmount = dispose;
      } catch (error) {
        console.error(`No se pudo cargar el microfrontend ${activeTab}:`, error);
        if (!cancelled) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      unmount?.();
      element.remove();
    };
  }, [activeTab, reloadKey, bookService, resumeSaga, offline]);

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

        {loadError && (
          <div id="mfe-error" role="alert" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No se pudo cargar este módulo. Verifica que su servidor esté en ejecución y pulsa "Recargar".
          </div>
        )}
        <div ref={container} style={{ flex: 1, minHeight: '660px', borderRadius: '10px', backgroundColor: '#0A0E17' }} />
      </div>
    </div>
  );
}
