-- Resumen del historial cargado en salon_crm: facturas, notas de crédito, puntos y saldos de las cuentas de demostración.
\set QUIET on
\pset footer off
SELECT 'facturas' AS dato, status AS detalle, count(*) AS cantidad, sum(total_amount) AS total FROM invoices WHERE id LIKE 'hist-%' GROUP BY status
UNION ALL SELECT 'notas de crédito', '', count(*), sum(amount) FROM credit_notes WHERE id LIKE 'hist-%'
UNION ALL SELECT 'puntos', type, count(*), sum(points) FROM loyalty_transactions WHERE id LIKE 'hist-%' GROUP BY type
UNION ALL SELECT 'clientes', 'historial', count(*), NULL FROM crm_clients WHERE id LIKE 'hist-%'
UNION ALL SELECT 'saldo', id, loyalty_points, NULL FROM crm_clients WHERE id IN ('cli-001', 'cli-002')
ORDER BY 1, 2;
