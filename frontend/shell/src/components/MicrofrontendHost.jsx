import React, { useEffect, useRef, useState } from 'react';
import { visibleTabsFor } from '../tabs';
import { Sparkles, Calendar, LayoutDashboard, RefreshCw } from 'lucide-react';

// Contratos de integración de los tres microfrontends, cargados con Module Federation
const MFE_CONFIGS = {
  'estudio-ia': {
    title: 'Estudio de belleza',
    load: () => import('mfe_estudio/mount'),
    domain: 'Diagnóstico de rostro y cabello, tu clóset y la comunidad del salón.',
    icon: Sparkles,
  },
  reservas: {
    title: 'Reservas',
    load: () => import('mfe_reservas/mount'),
    domain: 'Elige tu servicio, tu estilista y tu horario.',
    icon: Calendar,
  },
  gestion: {
    title: 'Gestión del salón',
    load: () => import('mfe_gestion/mount'),
    domain: 'Agenda, inventario, estilistas, clientes y asistentes.',
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
      <div style={{ padding: '8px 4px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'var(--rose-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconComponent size={20} color="var(--rose-deep)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.6rem' }} className="gold-gradient-text">{config.title}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{config.domain}</p>
          </div>
        </div>

        <button
          onClick={() => setReloadKey((key) => key + 1)}
          className="btn-outline"
          style={{ padding: '7px 14px', fontSize: '0.78rem' }}
          title="Volver a cargar esta sección"
        >
          <RefreshCw size={13} />
          Recargar
        </button>
      </div>

      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', minHeight: '700px', display: 'flex', flexDirection: 'column' }}>
        {loadError && (
          <div id="mfe-error" role="alert" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No se pudo cargar esta sección. Revisa tu conexión y pulsa "Recargar".
          </div>
        )}
        <div ref={container} style={{ flex: 1, minHeight: '660px' }} />
      </div>
    </div>
  );
}
