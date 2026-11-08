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
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '20px 24px 24px' }}>
      {/* El título de la sección ya lo muestra el Shell: aquí solo van las pestañas */}
      <nav className="inner-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'active' : ''}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'biometrics' && <Scanner />}
      {activeTab === 'brand' && <Brand />}
      {activeTab === 'closet' && <Closet />}
      {activeTab === 'community' && <Community />}
    </div>
  );
}
