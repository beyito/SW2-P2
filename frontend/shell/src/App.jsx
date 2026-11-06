import React, { useCallback, useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import MicrofrontendHost from './components/MicrofrontendHost';
import { Layers } from 'lucide-react';
import { currentUser, freshToken, initAuth, isSessionActive, keycloak, logout, restartLogin } from './auth/auth';

const SESSION_CHECK_MS = Number(import.meta.env.VITE_SESSION_CHECK_MS) || 15000;
const TOKEN_REFRESH_MS = 30000;

/** Pantalla de estado mientras se autentica o cuando la sesión terminó. */
function StatusScreen({ title, message, action }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-panel" style={{ padding: '32px', maxWidth: '440px', textAlign: 'center' }}>
        <h2 className="gold-gradient-text" style={{ marginTop: 0 }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
        {action}
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState('loading'); // loading | ready | error | ended
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [activeTab, setActiveTab] = useState('estudio-ia'); // estudio-ia | reservas | gestion

  // Inicio de sesión real contra Keycloak (CU-01)
  useEffect(() => {
    initAuth()
      .then((authenticated) => {
        if (!authenticated) return;
        setUser(currentUser());
        setToken(keycloak.token);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  const onSessionLost = useCallback(() => setStatus('ended'), []);

  // Mantiene el token vigente y lo entrega a los microfrontends
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const interval = setInterval(() => {
      freshToken().then(setToken).catch(onSessionLost);
    }, TOKEN_REFRESH_MS);
    return () => clearInterval(interval);
  }, [status, onSessionLost]);

  // Detecta si otra sesión desplazó a esta o si fue cerrada (RF-01)
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const interval = setInterval(async () => {
      if (!(await isSessionActive())) onSessionLost();
    }, SESSION_CHECK_MS);
    return () => clearInterval(interval);
  }, [status, onSessionLost]);

  if (status === 'loading') {
    return <StatusScreen title="Salón & IA Studio" message="Verificando tu sesión..." />;
  }

  if (status === 'error') {
    return (
      <StatusScreen
        title="No se pudo iniciar sesión"
        message="El servicio de autenticación no responde. Verifica que Keycloak esté en ejecución."
        action={<button className="btn-outline" onClick={() => window.location.reload()}>Reintentar</button>}
      />
    );
  }

  if (status === 'ended') {
    return (
      <StatusScreen
        title="Tu sesión terminó"
        message="Se cerró esta sesión o se inició una más reciente en otro dispositivo."
        action={<button id="btn-relogin" className="btn-outline" onClick={restartLogin}>Iniciar sesión de nuevo</button>}
      />
    );
  }

  const canManage = user.role === 'ADMIN' || user.role === 'STYLIST';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={user}
        canManage={canManage}
        onLogout={logout}
      />

      <main style={{ flex: 1, padding: '20px 0' }}>
        <div className="fade-in">
          <MicrofrontendHost activeTab={activeTab} currentUser={user} token={token} onSessionLost={onSessionLost} />
        </div>
      </main>

      <footer className="glass-panel" style={{ margin: '24px', padding: '16px 28px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <Layers size={14} color="var(--gold-primary)" />
        <span><strong>Shell Contenedor</strong>: React 18 • Dark Luxury Theme</span>
      </footer>
    </div>
  );
}
