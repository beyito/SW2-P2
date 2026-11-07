import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Sparkles, Upload, X } from 'lucide-react';
import { imageGenApi, loadStyleProfile } from '../api';

/**
 * Simulación de un corte, un color o una prenda sobre una foto del cliente.
 * La autorización va aparte del diagnóstico porque la foto sale hacia un servicio externo.
 * La imagen solo vive en esta ventana: al cerrarla no queda copia en la plataforma.
 */
export default function ImagePreview({ title, photoHint, approximate, generate, onClose }) {
  const [consent, setConsent] = useState(null);
  const [isMinor, setIsMinor] = useState(false);
  const [declaresAdult, setDeclaresAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const open = useRef(true);

  useEffect(() => {
    open.current = true;
    (async () => {
      try {
        const [profile, status] = await Promise.all([loadStyleProfile(), imageGenApi.consent()]);
        if (!open.current) return;
        setIsMinor(profile.ageRange === 'UNDER_18');
        setConsent(status);
      } catch (failure) {
        if (open.current) setError(failure.message);
      }
    })();
    return () => {
      open.current = false;
    };
  }, []);

  const accept = async () => {
    setError(null);
    try {
      await imageGenApi.grant(consent.policyVersion);
      setConsent(await imageGenApi.consent());
    } catch (failure) {
      setError(failure.message);
    }
  };

  const revoke = async () => {
    setError(null);
    try {
      await imageGenApi.revoke();
      setResult(null);
      setDeclaresAdult(false);
      setConsent(await imageGenApi.consent());
    } catch (failure) {
      setError(failure.message);
    }
  };

  const chooseFile = async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const generated = await generate(file);
      if (open.current) setResult(generated);
    } catch (failure) {
      if (!open.current) return;
      setError(failure.message);
      if (failure.code === 'IMAGE_CONSENT_REQUIRED') setConsent(await imageGenApi.consent());
    } finally {
      if (open.current) setBusy(false);
    }
  };

  const source = result ? `data:${result.media_type};base64,${result.image_base64}` : null;

  // Va en el body: el panel del Shell usa backdrop-filter, y dentro de él "fixed" no se mide contra la pantalla.
  // La clase mantiene los estilos con alcance de este microfrontend
  return createPortal(
    <div className="mfe-estudio preview-backdrop">
      <div id="preview-dialog" className="glass-panel preview-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="preview-header">
          <h3 className="gold-gradient-text studio-title">{title}</h3>
          <button id="btn-preview-close" type="button" className="preview-close" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
        </div>

        {!consent && !error && <p>Cargando...</p>}

        {consent && !consent.granted && isMinor && (
          <p id="preview-minor" className="studio-muted">La simulación con foto es solo para mayores de 18 años.</p>
        )}

        {consent && !consent.granted && !isMinor && (
          <div id="preview-consent">
            <p id="preview-consent-text" className="preview-policy">{consent.policyText}</p>
            <label className="preview-check">
              <input id="preview-adult" type="checkbox" checked={declaresAdult} onChange={(event) => setDeclaresAdult(event.target.checked)} />
              Soy mayor de 18 años y la foto es mía
            </label>
            <button id="btn-preview-accept" type="button" className="studio-primary" disabled={!declaresAdult} onClick={accept}>Acepto</button>
          </div>
        )}

        {consent?.granted && (
          <div id="preview-form">
            <p className="studio-muted">{photoHint}</p>
            {approximate && <p id="preview-approximate" className="studio-muted">Se muestra lo más parecido que ofrece el generador: el estilo real puede tener otros detalles.</p>}
            <label className={`studio-primary${busy ? ' disabled' : ''}`}>
              <Upload size={16} /> {result ? 'Probar con otra foto' : 'Elegir foto'}
              <input id="preview-file" type="file" hidden disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
            </label>
          </div>
        )}

        {busy && <p id="preview-busy" className="preview-busy"><Sparkles size={14} /> Generando la imagen, puede tardar hasta un minuto...</p>}
        {error && <p id="preview-error" className="studio-error" role="alert">{error}</p>}

        {result && (
          <figure id="preview-result" className="preview-result">
            <img id="preview-image" src={source} alt={`Simulación: ${title}`} />
            <figcaption id="preview-label">{result.label}</figcaption>
            <p className="studio-muted">Te quedan {result.remaining_today} imágenes hoy. Si cierras esta ventana no se conservará.</p>
            <a id="preview-download" className="studio-secondary" href={source} download="simulacion.jpg"><Download size={16} /> Descargar</a>
          </figure>
        )}

        {consent?.granted && (
          <button id="btn-preview-revoke" type="button" className="studio-link" onClick={revoke}>Retirar mi autorización para enviar fotos</button>
        )}
      </div>
    </div>,
    document.body,
  );
}
