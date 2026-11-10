-- Borra el historial de la Fase Y en salon_crm. A las cuentas de demostración se les resta
-- el saldo que les dio el historial; sus movimientos reales se conservan.
\set ON_ERROR_STOP on
BEGIN;
UPDATE crm_clients c
SET loyalty_points = GREATEST(0, c.loyalty_points - h.puntos)
FROM (SELECT client_id, sum(points) AS puntos FROM loyalty_transactions
      WHERE id LIKE 'hist-%' AND client_id NOT LIKE 'hist-%' GROUP BY client_id) h
WHERE c.id = h.client_id;
DELETE FROM loyalty_transactions WHERE id LIKE 'hist-%';
DELETE FROM credit_notes WHERE id LIKE 'hist-%';
DELETE FROM invoices WHERE id LIKE 'hist-%';
DELETE FROM notices WHERE recipient LIKE 'hist-%';
DELETE FROM crm_clients WHERE id LIKE 'hist-%';
COMMIT;
