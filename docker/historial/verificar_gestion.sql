-- Resumen del historial cargado en salon_gestion.
\set QUIET on
\pset footer off
SELECT current_database() AS base;
SELECT 'citas' AS dato, status AS detalle, count(*) AS cantidad FROM appointments WHERE id LIKE 'hist-%' AND to_regclass('appointments') IS NOT NULL GROUP BY status
UNION ALL SELECT 'reseñas', stylist_id, count(*) FROM stylist_reviews WHERE id LIKE 'hist-%' GROUP BY stylist_id
UNION ALL SELECT 'inventario', item_id || ' hoy=' || (SELECT current_stock FROM inventory_items i WHERE i.id = l.item_id)
              || ' min=' || min(new_stock) || ' ultimo=' || (array_agg(new_stock ORDER BY created_at DESC, id DESC))[1], count(*)
       FROM inventory_logs l WHERE id LIKE 'hist-%' GROUP BY item_id
ORDER BY 1, 2;
