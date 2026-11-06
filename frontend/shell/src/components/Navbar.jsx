import React from 'react';
import { Sparkles, Calendar, LayoutDashboard, LogOut, UserCheck } from 'lucide-react';

const TABS = [
  { id: 'estudio-ia', label: 'Estudio IA & Comunidad', icon: Sparkles },
  { id: 'reservas', label: 'Reservas', icon: Calendar },
  { id: 'gestion', label: 'ERP & Inventario', icon: LayoutDashboard, staffOnly: true },
];

export default function Navbar({ activeTab, setActiveTab, currentUser, canManage, onLogout }) {
  // El módulo de gestión solo se ofrece al personal; el backend también lo exige
  const visibleTabs = TABS.filter((tab) => !tab.staffOnly || canManage);

  return (
    <header className="glass-panel" style={{ margin: '16px 24px', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: '16px', zIndex: 100 }}>
      {/* Marca */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #F5D061, #D4AF37)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(212, 175, 55, 0.4)' }}>
          <Sparkles size={22} color="#0A0E17" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }} className="gold-gradient-text">
            SALÓN & IA STUDIO
          </h1>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Plataforma Omnicanal B2B2C
          </span>
        </div>
      </div>

      {/* Navegación entre microfrontends */}
      <nav style={{ display: 'flex', gap: '8px', background: 'rgba(0, 0, 0, 0.3)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`tab-mfe-${id}`}
            onClick={() => setActiveTab(id)}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.88rem',
              fontWeight: 600,
              transition: 'all 0.2s',
              background: activeTab === id ? 'linear-gradient(135deg, #F5D061, #D4AF37)' : 'transparent',
              color: activeTab === id ? '#0A0E17' : 'var(--text-secondary)',
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {/* Usuario autenticado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <span id="current-user" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
          <UserCheck size={14} color="var(--gold-primary)" />
          {currentUser.name} ({currentUser.role})
        </span>
        <button
          id="btn-logout"
          onClick={onLogout}
          className="btn-outline"
          style={{ padding: '6px 14px', fontSize: '0.8rem', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Cerrar sesión"
        >
          <LogOut size={14} />
          Salir
        </button>
      </div>
    </header>
  );
}
