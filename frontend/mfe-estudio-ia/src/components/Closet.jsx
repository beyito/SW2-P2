import React, { useEffect, useState } from 'react';
import { closetApi, imageSource, uploadImage } from '../api';
import { currentUser, offlineStore } from '../auth';

const CATEGORIES = { TOP: 'Parte superior', BOTTOM: 'Parte inferior', SHOES: 'Calzado', ACCESSORY: 'Accesorio', OUTERWEAR: 'Abrigo' };
const SEASONS = { SPRING: 'Primavera', SUMMER: 'Verano', AUTUMN: 'Otoño', WINTER: 'Invierno', ALL_SEASON: 'Todo el año' };
const EMPTY = { name: '', category: 'TOP', color: '', season: 'ALL_SEASON' };

/** Armario virtual del cliente, guardado en ms-asesoria (CU-15). */
export default function Closet() {
  const [items, setItems] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [draft, setDraft] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reload = async (id) => setItems(await closetApi.list(id));

  useEffect(() => {
    (async () => {
      try {
        const { id } = await currentUser();
        setClientId(id);
        await reload(id);
      } catch (failure) {
        setError(failure.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cuando la cola local termina de enviar, la lista debe mostrar lo que quedó en el servidor
  useEffect(() => {
    if (!clientId) return undefined;
    return offlineStore()?.subscribe(() => reload(clientId).catch(() => {}));
  }, [clientId]);

  const resetForm = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setFile(null);
    setFileKey((key) => key + 1);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const changes = { ...draft };
      if (file) changes.imageUrl = await uploadImage(file);
      if (editingId) await closetApi.update(editingId, changes);
      else await closetApi.create(changes);
      resetForm();
      await reload(clientId);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraft({ name: item.name, category: item.category, color: item.color, season: item.season });
  };

  const remove = async (item) => {
    setError(null);
    try {
      await closetApi.remove(item.id);
      if (editingId === item.id) resetForm();
      await reload(clientId);
    } catch (failure) {
      setError(failure.message);
    }
  };

  return (
    <div className="studio-columns">
      <div className="glass-panel studio-panel">
        <h3 className="gold-gradient-text studio-title">Armario Virtual (CU-15)</h3>
        {error && <p id="closet-error" className="studio-error" role="alert">{error}</p>}
        {loading && <p>Cargando...</p>}
        {!loading && items.length === 0 && <p id="closet-empty" className="studio-muted">Aún no tienes prendas. Agrega la primera.</p>}
        <div className="closet-grid">
          {items.map((item) => (
            <div key={item.id} className="closet-item" data-name={item.name}>
              {item.imageUrl
                ? <img src={imageSource(item.imageUrl)} alt={item.name} className="closet-image" />
                : <div className="closet-image closet-placeholder">Sin foto</div>}
              <div className="closet-body">
                <strong className="closet-name">{item.name}</strong>
                <div className="studio-muted closet-detail">{CATEGORIES[item.category]} · {item.color} · {SEASONS[item.season]}</div>
                <div className="studio-row">
                  <button type="button" className="studio-btn btn-edit-item" onClick={() => startEdit(item)}>Editar</button>
                  <button type="button" className="studio-btn danger btn-remove-item" onClick={() => remove(item)}>Eliminar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel studio-panel">
        <h3 className="gold-gradient-text studio-title">{editingId ? 'Editar prenda' : 'Agregar prenda'}</h3>
        <form onSubmit={save} className="studio-form">
          <label>Nombre
            <input id="closet-name" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>Color
            <input id="closet-color" required maxLength={80} value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </label>
          <label>Categoría
            <select id="closet-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Temporada
            <select id="closet-season" value={draft.season} onChange={(e) => setDraft({ ...draft, season: e.target.value })}>
              {Object.entries(SEASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Foto (JPEG, PNG o WebP, hasta 5 MB)
            <input key={fileKey} id="closet-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] ?? null)} />
          </label>
          <button id="closet-save" type="submit" className="studio-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          {editingId && <button type="button" className="studio-btn" onClick={resetForm}>Cancelar</button>}
        </form>
      </div>
    </div>
  );
}
