import { describe, expect, it } from 'vitest';
import { initialTabFor, visibleTabsFor } from './tabs';

const ids = (role, canManage) => visibleTabsFor(role, canManage).map((tab) => tab.id);

describe('pestañas del Shell por rol', () => {
  it('la recepción solo ve el ERP y empieza ahí', () => {
    expect(ids('RECEPTIONIST', true)).toEqual(['gestion']);
    expect(initialTabFor('RECEPTIONIST', true)).toBe('gestion');
  });

  it('el cliente ve el estudio y las reservas, pero no el ERP', () => {
    expect(ids('CLIENT', false)).toEqual(['estudio-ia', 'reservas']);
    expect(initialTabFor('CLIENT', false)).toBe('estudio-ia');
  });

  it('la administración y los estilistas ven las tres', () => {
    expect(ids('ADMIN', true)).toEqual(['estudio-ia', 'reservas', 'gestion']);
    expect(ids('STYLIST', true)).toEqual(['estudio-ia', 'reservas', 'gestion']);
  });
});
