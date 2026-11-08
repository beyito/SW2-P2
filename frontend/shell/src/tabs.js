import { Calendar, LayoutDashboard, Sparkles } from 'lucide-react';

/**
 * Pestañas del Shell y quién las ve. Ocultar una pestaña es comodidad: quien autoriza es cada servicio.
 * - El ERP es solo para el personal.
 * - La recepción trabaja solo en el ERP: el estudio y las reservas son del cliente.
 */
export const TABS = [
  { id: 'estudio-ia', label: 'Estudio IA & Comunidad', icon: Sparkles, hiddenFor: ['RECEPTIONIST'] },
  { id: 'reservas', label: 'Reservas', icon: Calendar, hiddenFor: ['RECEPTIONIST'] },
  { id: 'gestion', label: 'ERP & Inventario', icon: LayoutDashboard, staffOnly: true },
];

/** Pestañas que ve un rol, en el orden de la barra. */
export function visibleTabsFor(role, canManage) {
  return TABS.filter((tab) => (!tab.staffOnly || canManage) && !tab.hiddenFor?.includes(role));
}

/** Pestaña con la que empieza cada rol: la primera que puede ver. */
export function initialTabFor(role, canManage) {
  return visibleTabsFor(role, canManage)[0]?.id ?? 'estudio-ia';
}
