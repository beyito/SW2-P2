import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { iaApi, loadStyleProfile } from '../api';

const PLATFORMS = { LINKEDIN: 'LinkedIn', INSTAGRAM: 'Instagram', TIKTOK: 'TikTok', FACEBOOK: 'Facebook' };

/** Asesoría de imagen por red social, con el diagnóstico y el clóset del cliente (CU-16, RF-06). */
export default function Brand() {
  const [platform, setPlatform] = useState('LINKEDIN');
  const [goal, setGoal] = useState('');
  const [sector, setSector] = useState('');
  const [strategy, setStrategy] = useState(null);
  const [declared, setDeclared] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadStyleProfile().then(setDeclared);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStrategy(await iaApi.brand({
        platform,
        goal: goal.trim() || null,
        sector: sector.trim() || null,
        gender: declared.gender ?? null,
        age_range: declared.ageRange ?? null,
      }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="studio-columns">
      <form className="glass-panel" style={{ padding: '24px', minWidth: 0 }} onSubmit={submit}>
        <h3 className="gold-gradient-text" style={{ margin: '0 0 14px', fontSize: '1.15rem' }}>Tu imagen en redes</h3>
        <div className="studio-filters" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <label className="studio-field">
            Red social
            <select id="brand-platform" value={platform} onChange={(event) => setPlatform(event.target.value)}>
              {Object.entries(PLATFORMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="studio-field">
            Sector (opcional)
            <input id="brand-sector" maxLength={80} value={sector} onChange={(event) => setSector(event.target.value)} placeholder="Diseño, salud, ventas..." />
          </label>
          <label className="studio-field">
            Objetivo (opcional)
            <input id="brand-goal" maxLength={200} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Conseguir clientes, cambiar de trabajo..." />
          </label>
        </div>
        <div className="studio-actions">
          <button id="brand-submit" className="studio-primary" disabled={busy}><Sparkles size={16} /> {busy ? 'Preparando...' : 'Obtener asesoría'}</button>
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Para redactar la biografía se envían a Gemini la red, el sector, el objetivo, el look y los colores.
          Nunca tu nombre, tu foto, tu edad, tu género ni tus rasgos.
        </p>
        {error && <p id="brand-error" className="studio-error" role="alert">{error}</p>}
      </form>

      <section className="glass-panel" style={{ padding: '24px', minWidth: 0 }}>
        {!strategy ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', fontSize: '0.9rem' }}>Elige una red para ver tu asesoría.</p>
        ) : (
          <div id="brand-result">
            <h3 className="gold-gradient-text" style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>{PLATFORMS[strategy.platform]}</h3>
            <p id="brand-personalized" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
              {strategy.personalized ? 'Personalizada con tu último diagnóstico.' : 'Sin personalizar: haz un diagnóstico para adaptarla a ti.'}
            </p>
            <dl className="studio-result">
              <dt>Tono</dt><dd>{strategy.tone}</dd>
              <dt>Corte</dt><dd id="brand-look">{strategy.recommended_look}</dd>
              <dt>Color</dt><dd id="brand-color">{strategy.recommended_color}</dd>
              <dt>Luz</dt><dd>{strategy.lighting_tip}</dd>
              <dt>Encuadre</dt><dd>{strategy.framing_tip}</dd>
            </dl>
            <div id="brand-palette" className="studio-chips">
              {strategy.color_palette.map((color) => <span key={color}>{color}</span>)}
            </div>
            {strategy.closet_matches.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 6px' }}>De tu clóset, combinan:</h4>
                <ul id="brand-closet" style={{ margin: 0, paddingLeft: '18px', fontSize: '0.88rem' }}>
                  {strategy.closet_matches.map((item) => <li key={item.id}>{item.name} ({item.color})</li>)}
                </ul>
              </>
            )}
            <h4 style={{ margin: '16px 0 6px' }}>Biografía sugerida</h4>
            <p id="brand-bio" style={{ fontSize: '0.9rem', margin: 0 }}>{strategy.bio}</p>
            <h4 style={{ margin: '16px 0 6px' }}>Ideas de publicaciones</h4>
            <ul id="brand-ideas" style={{ margin: 0, paddingLeft: '18px', fontSize: '0.88rem' }}>
              {strategy.content_ideas.map((idea) => <li key={idea}>{idea}</li>)}
            </ul>
            <p id="brand-engine" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 0 }}>Textos: {strategy.generated_by}</p>
          </div>
        )}
      </section>
    </div>
  );
}
