import React, { useState } from 'react';
import Brand from './components/Brand';
import Closet from './components/Closet';
import Community from './components/Community';
import Scanner from './components/Scanner';

const TABS = [
  { id: 'biometrics', label: 'Diagnóstico y estilos' },
  { id: 'brand', label: 'Marca personal' },
  { id: 'closet', label: 'Clóset virtual' },
  { id: 'community', label: 'Comunidad' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('biometrics');

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      <header className="glass-panel" style={{ padding: '18px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px' }}>
        <h2 className="gold-gradient-text" style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
          Estudio IA y Comunidad
        </h2>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                background: activeTab === tab.id ? 'linear-gradient(135deg, #F5D061, #D4AF37)' : 'transparent',
                color: activeTab === tab.id ? '#0A0E17' : 'var(--text-secondary)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'biometrics' && <Scanner />}
      {activeTab === 'brand' && <Brand />}
      {activeTab === 'closet' && <Closet />}
      {activeTab === 'community' && <Community />}
    </div>
  );
}
