import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Sparkles, Upload, Video } from 'lucide-react';
import { biometricsApi, iaApi } from '../api';
import { askShell } from '../auth';
import { FACE_SHAPES, HAIR_TONES, HAIR_TYPES, LENGTHS, MAINTENANCE, UNDERTONES, VIBES } from '../labels';

const RECORD_MS = 4000;
const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
const EMPTY_PROFILE = { face_shape: '', hair_type: '', hair_tone: '', skin_undertone: '', length: '', maintenance: '', vibe: '' };

const percent = (value) => `${Math.round(value * 100)}%`;

function Select({ id, label, value, options, onChange }) {
  return (
    <label className="studio-field">
      {label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sin indicar</option>
        {Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

/** Diagnóstico con consentimiento, cámara o archivo, y recomendaciones del catálogo real (CU-13, CU-14). */
export default function Scanner() {
  const [consent, setConsent] = useState(null);
  const [manual, setManual] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [recommendations, setRecommendations] = useState([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const requestRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const showDiagnosis = useCallback((result) => {
    setDiagnosis(result);
    setProfile((current) => ({
      ...current,
      face_shape: result.faceShape,
      hair_type: result.hairType ?? '',
      hair_tone: result.hairTone ?? '',
      skin_undertone: result.skinUndertone,
    }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await biometricsApi.consent();
        setConsent(status);
        if (status.granted) {
          const [latest] = await biometricsApi.diagnoses();
          if (latest) showDiagnosis(latest);
        }
      } catch (failure) {
        setError(failure.message);
      }
    })();
    return stopCamera;
  }, [showDiagnosis, stopCamera]);

  // Las recomendaciones siguen al perfil; si llegan respuestas cruzadas, solo vale la más reciente
  useEffect(() => {
    const attributes = Object.fromEntries(Object.entries(profile).filter(([, value]) => value));
    if (Object.keys(attributes).length === 0) {
      setRecommendations([]);
      return;
    }
    const request = ++requestRef.current;
    iaApi.recommend(attributes)
      .then((result) => {
        if (request === requestRef.current) setRecommendations(result);
      })
      .catch((failure) => {
        if (request === requestRef.current) setError(failure.message);
      });
  }, [profile]);

  const accept = async () => {
    setError(null);
    try {
      await biometricsApi.grant(consent.policyVersion);
      setConsent(await biometricsApi.consent());
    } catch (failure) {
      setError(failure.message);
    }
  };

  const analyze = async (file, label) => {
    setBusy(label);
    setError(null);
    try {
      showDiagnosis(await iaApi.scan(file));
    } catch (failure) {
      setError(failure.message);
      if (failure.code === 'CONSENT_REQUIRED') setConsent(await biometricsApi.consent());
    } finally {
      setBusy('');
    }
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      // El elemento de video existe desde el primer render de esta sección
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    } catch {
      setError('No se pudo abrir la cámara. Revise el permiso del navegador o suba un archivo.');
      stopCamera();
    }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      stopCamera();
      await analyze(new File([blob], 'foto.jpg', { type: 'image/jpeg' }), 'Analizando la foto...');
    }, 'image/jpeg', 0.92);
  };

  const recordVideo = () => {
    const mimeType = VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      stopCamera();
      const type = recorder.mimeType || 'video/webm';
      await analyze(new File(chunks, 'video', { type }), 'Analizando el video...');
    };
    setBusy('Grabando 4 segundos. Mire de frente a la cámara...');
    recorder.start();
    setTimeout(() => recorder.stop(), RECORD_MS);
  };

  const uploadFile = async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) await analyze(file, 'Analizando el archivo...');
  };

  const deleteResult = async () => {
    setError(null);
    try {
      await biometricsApi.deleteDiagnosis(diagnosis.id);
      const [previous] = await biometricsApi.diagnoses();
      if (previous) {
        showDiagnosis(previous);
      } else {
        setDiagnosis(null);
        setProfile(EMPTY_PROFILE);
      }
    } catch (failure) {
      setError(failure.message);
    }
  };

  const revoke = async () => {
    setError(null);
    try {
      await biometricsApi.revoke();
      stopCamera();
      setDiagnosis(null);
      setProfile(EMPTY_PROFILE);
      setConfirmingRevoke(false);
      setManual(false);
      setConsent(await biometricsApi.consent());
    } catch (failure) {
      setError(failure.message);
    }
  };

  const change = (field) => (value) => setProfile((current) => ({ ...current, [field]: value }));

  if (!consent) {
    return <div className="glass-panel" style={{ padding: '24px' }}>{error ? <p id="scan-error" className="studio-error">{error}</p> : 'Cargando...'}</div>;
  }

  const canScan = consent.granted;

  return (
    <div className="studio-columns">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 className="gold-gradient-text" style={{ margin: '0 0 14px', fontSize: '1.15rem' }}>Diagnóstico facial y capilar</h3>

          {!canScan && !manual && (
            <div id="consent-panel">
              <p style={{ fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text-secondary)' }} id="consent-text">{consent.policyText}</p>
              <div className="studio-actions">
                <button id="btn-consent" className="studio-primary" onClick={accept}><Check size={16} /> Acepto</button>
                <button id="btn-manual" className="studio-secondary" onClick={() => setManual(true)}>Prefiero indicar mis rasgos a mano</button>
              </div>
            </div>
          )}

          {!canScan && manual && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              No se analizará ninguna imagen. <button id="btn-show-consent" className="studio-link" onClick={() => setManual(false)}>Usar el diagnóstico automático</button>
            </p>
          )}

          {canScan && (
            <div id="scan-panel">
              <div className="studio-camera" hidden={!cameraOn}>
                <video ref={videoRef} id="camera-preview" muted playsInline />
              </div>
              <div className="studio-actions">
                {!cameraOn && (
                  <button id="btn-camera" className="studio-primary" disabled={Boolean(busy)} onClick={startCamera}><Camera size={16} /> Abrir cámara</button>
                )}
                {cameraOn && (
                  <>
                    <button id="btn-photo" className="studio-primary" disabled={Boolean(busy)} onClick={takePhoto}><Camera size={16} /> Tomar foto</button>
                    <button id="btn-record" className="studio-secondary" disabled={Boolean(busy)} onClick={recordVideo}><Video size={16} /> Grabar 4 segundos</button>
                  </>
                )}
                <label className={`studio-secondary${busy ? ' disabled' : ''}`}>
                  <Upload size={16} /> Subir foto o video
                  <input id="scan-file" type="file" hidden disabled={Boolean(busy)} accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={uploadFile} />
                </label>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '10px 0 0' }}>
                Foto JPEG, PNG o WebP, o video de 3 a 5 segundos. Se descarta al terminar el análisis.
              </p>
            </div>
          )}

          {busy && <p id="scan-busy" style={{ color: 'var(--gold-primary)', fontSize: '0.88rem' }}><Sparkles size={14} /> {busy}</p>}
          {error && <p id="scan-error" className="studio-error" role="alert">{error}</p>}
        </section>

        {diagnosis && (
          <section id="diagnosis" className="glass-panel" style={{ padding: '24px' }}>
            <h3 className="gold-gradient-text" style={{ margin: '0 0 12px', fontSize: '1.05rem' }}>Resultado</h3>
            <dl className="studio-result">
              <dt>Forma de rostro</dt>
              <dd id="result-shape">{FACE_SHAPES[diagnosis.faceShape]} <small>{percent(diagnosis.faceShapeConfidence)}</small></dd>
              <dt>Subtono de piel</dt>
              <dd id="result-undertone">{UNDERTONES[diagnosis.skinUndertone]} <small>{percent(diagnosis.undertoneConfidence)}</small></dd>
              <dt>Tipo de cabello</dt>
              <dd id="result-hair">
                {diagnosis.hairType
                  ? <>{HAIR_TYPES[diagnosis.hairType]} <small>{percent(diagnosis.hairTypeConfidence)}</small></>
                  : 'No se ve lo suficiente'}
              </dd>
              {diagnosis.hairTone && <><dt>Tono de cabello</dt><dd>{HAIR_TONES[diagnosis.hairTone]}</dd></>}
              <dt>Analizado desde</dt>
              <dd id="result-source">{diagnosis.source === 'VIDEO' ? `Video (${diagnosis.framesAnalyzed} fotogramas)` : 'Foto'}</dd>
            </dl>
            <div id="result-palette" className="studio-chips">
              {diagnosis.recommendedPalette.map((color) => <span key={color}>{color}</span>)}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Es una estimación automática, que depende de la luz y del ángulo. Tu estilista la confirma en la cita.
              Se borrará el {new Date(diagnosis.expiresAt).toLocaleDateString()}.
            </p>
            <div className="studio-actions">
              <button id="btn-delete-result" className="studio-secondary" onClick={deleteResult}>Borrar este resultado</button>
            </div>
          </section>
        )}

        {canScan && (
          <section className="glass-panel" style={{ padding: '16px 24px' }}>
            {!confirmingRevoke ? (
              <button id="btn-revoke" className="studio-link" onClick={() => setConfirmingRevoke(true)}>Retirar mi consentimiento y borrar mis datos biométricos</button>
            ) : (
              <div>
                <p style={{ fontSize: '0.88rem', marginTop: 0 }}>Se borrarán todos tus resultados y no se podrán recuperar.</p>
                <div className="studio-actions">
                  <button id="btn-revoke-confirm" className="studio-danger" onClick={revoke}>Sí, retirar y borrar</button>
                  <button className="studio-secondary" onClick={() => setConfirmingRevoke(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <section className="glass-panel" style={{ padding: '24px', minWidth: 0 }}>
        <h3 className="gold-gradient-text" style={{ margin: '0 0 14px', fontSize: '1.15rem' }}>Recomendaciones de estilo</h3>
        {(canScan || manual) && (
          <div className="studio-filters">
            <Select id="pref-face" label="Rostro" value={profile.face_shape} options={FACE_SHAPES} onChange={change('face_shape')} />
            <Select id="pref-hair" label="Cabello" value={profile.hair_type} options={HAIR_TYPES} onChange={change('hair_type')} />
            <Select id="pref-tone" label="Tono" value={profile.hair_tone} options={HAIR_TONES} onChange={change('hair_tone')} />
            <Select id="pref-undertone" label="Subtono" value={profile.skin_undertone} options={UNDERTONES} onChange={change('skin_undertone')} />
            <Select id="pref-length" label="Largo" value={profile.length} options={LENGTHS} onChange={change('length')} />
            <Select id="pref-maintenance" label="Mantenimiento" value={profile.maintenance} options={MAINTENANCE} onChange={change('maintenance')} />
            <Select id="pref-vibe" label="Estilo" value={profile.vibe} options={VIBES} onChange={change('vibe')} />
          </div>
        )}
        {recommendations.length === 0 ? (
          <p id="no-recommendations" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', fontSize: '0.9rem' }}>
            Haz un diagnóstico o indica tus rasgos para ver recomendaciones.
          </p>
        ) : (
          <div id="recommendations" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recommendations.map((style) => (
              <article key={style.style_id} className="studio-style" data-style={style.style_id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
                  <strong>{style.style_name}</strong>
                  <span style={{ color: 'var(--gold-primary)', fontWeight: 800, whiteSpace: 'nowrap' }}>{percent(style.match_score)}</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>{style.reason}</p>
                {style.matched_factors.length > 0 && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Según {style.matched_factors.join(', ')}.</p>
                )}
                {style.service && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                    <span style={{ fontSize: '0.8rem' }}>{style.service.name}: ${Number(style.service.price).toFixed(2)}</span>
                    <button className="studio-secondary btn-book" onClick={() => askShell({ type: 'SALON_BOOK', serviceId: style.service.id })}>Reservar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
