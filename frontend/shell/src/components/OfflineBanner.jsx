import React, { useEffect, useState } from 'react';
import { CONFLICT, DONE, PENDING } from '../offline/queue';

/** Estado de la conexión y de las operaciones guardadas en este dispositivo (CU-22). */
export default function OfflineBanner({ store, onPay }) {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(store.isOnline());

  useEffect(() => {
    const refresh = () => {
      setOnline(store.isOnline());
      store.list().then(setItems);
    };
    refresh();
    const unsubscribe = store.subscribe(refresh);
    const stop = store.start();
    return () => {
      unsubscribe();
      stop();
    };
  }, [store]);

  const pending = items.filter((item) => item.status === PENDING);
  const others = items.filter((item) => item.status !== PENDING);
  if (online && items.length === 0) return null;

  return (
    <div id="offline-banner" role="status" className="glass-panel" style={{ margin: '0 24px', padding: '12px 20px', fontSize: '0.86rem' }}>
      {!online && <strong id="offline-state" className="text-warning">Sin conexión. </strong>}
      {pending.length > 0 && (
        <span id="offline-pending" data-count={pending.length}>
          {pending.length === 1 ? '1 operación guardada' : `${pending.length} operaciones guardadas`} en este dispositivo: {online ? 'enviando...' : 'se enviarán al volver la conexión.'}
        </span>
      )}
      {!online && pending.length === 0 && <span>Puedes seguir consultando lo último que viste.</span>}
      {others.map((item) => (
        <div key={item.id} className="offline-item" data-status={item.status} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
          {item.status === CONFLICT && <span className="text-danger">No se pudo completar "{item.label}": {item.error}</span>}
          {item.status === DONE && <span className="text-success">"{item.label}" se envió. Revisa si el turno sigue libre y paga en los próximos 15 minutos para confirmarlo.</span>}
          {item.status === DONE && (
            <button
              type="button"
              className="btn-gold offline-pay"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={() => {
                store.discard(item.id);
                onPay(item.result.sagaId);
              }}
            >
              Continuar
            </button>
          )}
          <button type="button" className="btn-outline offline-discard" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => store.discard(item.id)}>
            {item.status === DONE ? 'Ocultar' : 'Descartar'}
          </button>
        </div>
      ))}
    </div>
  );
}
