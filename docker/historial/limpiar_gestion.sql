-- Borra el historial de la Fase Y en salon_gestion. El stock actual no cambia, porque el
-- historial nunca lo modificó: solo se quitan sus movimientos, reseñas y citas.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM stylist_reviews WHERE id LIKE 'hist-%';
DELETE FROM inventory_logs WHERE id LIKE 'hist-%';
DELETE FROM appointments WHERE id LIKE 'hist-%';
COMMIT;
