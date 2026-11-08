import React, { useCallback, useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import MicrofrontendHost from './components/MicrofrontendHost';
import OfflineBanner from './components/OfflineBanner';
import Onboarding from './components/Onboarding';
import { createOfflineStore } from './offline/queue';
import { needsOnboarding } from './auth/profile';
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
  const [activeTab, setActiveTab] = useState('estudio-ia'); // estudio-ia | reservas | gestion
  // Servicio elegido en una recomendación; se olvida al cambiar de pestaña a mano
  const [bookService, setBookService] = useState(null);
  const [onboarding, setOnboarding] = useState('checking'); // checking | pending | done
  const [offlineStore, setOfflineStore] = useState(null);
  const [storageFailed, setStorageFailed] = useState(false);
  // Reserva guardada sin conexión que ya se envió y falta pagar
  const [resumeSaga, setResumeSaga] = useState(null);
  const changeTab = (tab) => {
    setBookService(null);
    setResumeSaga(null);
    setActiveTab(tab);
  };
  const openBooking = (serviceId) => {
    setResumeSaga(null);
    setBookService(serviceId);
    setActiveTab('reservas');
  };

  // Inicio de sesión real contra Keycloak (CU-01)
  useEffect(() => {
    initAuth()
      .then((authenticated) => {
        if (!authenticated) return;
        const identity = currentUser();
        setUser(identity);
        // La recepción trabaja en el ERP: empieza ahí y no en el estudio del cliente
        if (identity.role === 'RECEPTIONIST') setActiveTab('gestion');
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  const onSessionLost = useCallback(() => setStatus('ended'), []);

  const payOfflineBooking = (sagaId) => {
    setBookService(null);
    setResumeSaga(sagaId);
    setActiveTab('reservas');
  };

  // Si IndexedDB no está disponible, la plataforma funciona igual, sin modo offline
  useEffect(() => {
    if (status !== 'ready') return;
    createOfflineStore({ userId: user.id, getToken: freshToken, onSessionLost })
      .then(setOfflineStore)
      .catch((error) => {
        console.error('Sin almacenamiento local:', error);
        setStorageFailed(true);
      });
  }, [status, user, onSessionLost]);

  // El cuestionario inicial es solo para clientes; un fallo del CRM no debe impedir usar la plataforma
  useEffect(() => {
    if (status !== 'ready') return;
    if (user.role !== 'CLIENT') {
      setOnboarding('done');
      return;
    }
    needsOnboarding()
      .then((pending) => setOnboarding(pending ? 'pending' : 'done'))
      .catch(() => setOnboarding('done'));
  }, [status, user]);

  // Renueva el token antes de que venza; si ya no se puede, la sesión terminó
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const interval = setInterval(() => {
      freshToken().catch(onSessionLost);
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

  const canManage = ['ADMIN', 'STYLIST', 'RECEPTIONIST'].includes(user.role);
  const offlineReady = offlineStore !== null || storageFailed;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={changeTab}
        currentUser={user}
        canManage={canManage}
        onLogout={logout}
      />

      <main style={{ flex: 1, padding: '20px 0' }}>
        {offlineStore && <OfflineBanner store={offlineStore} onPay={payOfflineBooking} />}
        <div className="fade-in" style={{ marginTop: '12px' }}>
          {onboarding === 'pending' && <Onboarding onDone={() => setOnboarding('done')} />}
          {onboarding === 'done' && offlineReady && (
            <MicrofrontendHost activeTab={activeTab} currentUser={user} getToken={freshToken} onSessionLost={onSessionLost} bookService={bookService} resumeSaga={resumeSaga} onBook={openBooking} offline={offlineStore} />
          )}
        </div>
      </main>

      <footer className="glass-panel" style={{ margin: '24px', padding: '16px 28px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <Layers size={14} color="var(--gold-primary)" />
        <span><strong>Shell Contenedor</strong>: React 18 • Dark Luxury Theme</span>
      </footer>
    </div>
  );
}
