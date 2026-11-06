import React, { useState } from 'react';
import { saveStyleProfile } from '../auth/profile';

const QUESTIONS = [
  { field: 'gender', label: '¿Qué estilos quieres ver?', options: { FEMALE: 'Para mujer', MALE: 'Para hombre', NON_BINARY: 'Todos (no binario)', UNDISCLOSED: 'Todos (prefiero no decirlo)' } },
  { field: 'ageRange', label: 'Rango de edad', options: { UNDER_18: 'Menos de 18', '18_29': '18 a 29', '30_44': '30 a 44', '45_59': '45 a 59', '60_PLUS': '60 o más' } },
  { field: 'preferredLength', label: 'Largo de cabello que prefieres', options: { SHORT: 'Corto', MEDIUM: 'Medio', LONG: 'Largo' } },
  { field: 'maintenance', label: 'Tiempo que quieres dedicarle', options: { LOW: 'Poco', MEDIUM: 'Algo', HIGH: 'Bastante' } },
  { field: 'vibe', label: 'Estilo que buscas', options: { NATURAL: 'Natural', PROFESSIONAL: 'Profesional', TRENDY: 'En tendencia', BOLD: 'Atrevido' } },
];

/** Cuestionario de la primera sesión: todo es opcional y se puede cambiar después en "Mi perfil". */
export default function Onboarding({ onDone }) {
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const finish = async (values) => {
    setSaving(true);
    setError(null);
    try {
      await saveStyleProfile(values);
      onDone();
    } catch (failure) {
      setError(failure.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '0 24px' }}>
      <form
        id="onboarding"
        className="glass-panel"
        style={{ padding: '28px' }}
        onSubmit={(event) => {
          event.preventDefault();
          finish(answers);
        }}
      >
        <h2 className="gold-gradient-text" style={{ marginTop: 0 }}>Cuéntanos un poco de ti</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          Lo usamos solo para que tus recomendaciones sean más acertadas. Es opcional, el personal del salón no lo ve
          y puedes cambiarlo cuando quieras en &quot;Mi perfil&quot;.
        </p>
        <div style={{ display: 'grid', gap: '14px', margin: '18px 0' }}>
          {QUESTIONS.map(({ field, label, options }) => (
            <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {label}
              <select
                id={`onboarding-${field}`}
                value={answers[field] ?? ''}
                onChange={(event) => setAnswers((current) => ({ ...current, [field]: event.target.value || undefined }))}
                style={{ background: 'rgba(0, 0, 0, 0.35)', color: '#fff', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '10px', font: 'inherit' }}
              >
                <option value="">Sin responder</option>
                {Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
          ))}
        </div>
        {error && <p role="alert" style={{ color: '#FCA5A5', fontSize: '0.85rem' }}>{error}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <button id="onboarding-save" type="submit" className="btn-gold" disabled={saving}>Guardar y continuar</button>
          <button id="onboarding-skip" type="button" className="btn-outline" disabled={saving} onClick={() => finish({})}>Omitir por ahora</button>
        </div>
      </form>
    </div>
  );
}
