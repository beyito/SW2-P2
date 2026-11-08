import React from 'react';
import { Scissors, LogOut } from 'lucide-react';
import { visibleTabsFor } from '../tabs';

// Nombre del rol tal como lo ve la persona
export const ROLE_LABELS = {
  ADMIN: 'Administración',
  RECEPTIONIST: 'Recepción',
  STYLIST: 'Estilista',
  CLIENT: 'Cliente',
};

export default function Navbar({ activeTab, setActiveTab, currentUser, canManage, onLogout }) {
  // Cada rol ve sus pestañas; el backend también exige el rol en cada petición
  const visibleTabs = visibleTabsFor(currentUser.role, canManage);

  return (
    <header className="glass-panel" style={{ margin: '16px 24px', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', position: 'sticky', top: '16px', zIndex: 100 }}>
      {/* Marca */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--rose-soft)', border: '1px solid var(--rose)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Scissors size={20} color="var(--rose-deep)" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 600, margin: 0, lineHeight: 1.1 }} className="gold-gradient-text">
            Salón & IA Studio
          </h1>
          <span style={{ fontSize: '0.72rem', color: 'var(--gold-primary)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Belleza e imagen personal
          </span>
        </div>
      </div>

      {/* Secciones de la plataforma */}
      <nav style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '999px' }}>
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`tab-mfe-${id}`}
            onClick={() => setActiveTab(id)}
            className={`shell-tab${activeTab === id ? ' active' : ''}`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {/* Usuario autenticado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--gold-soft)', color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>
          {currentUser.avatar}
        </span>
        <span id="current-user" style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', lineHeight: 1.2 }}>
          <strong>{currentUser.name}</strong>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{ROLE_LABELS[currentUser.role] ?? currentUser.role}</span>
        </span>
        <button
          id="btn-logout"
          onClick={onLogout}
          className="btn-outline"
          style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          title="Cerrar sesión"
        >
          <LogOut size={14} />
          Salir
        </button>
      </div>
    </header>
  );
}
