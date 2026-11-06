import { describe, expect, it } from 'vitest';
import { isoDate, messageOf } from './config';

describe('utilidades', () => {
  it('formatea la fecha local con ceros', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('muestra el mensaje real de un error', () => {
    expect(messageOf(new Error('Fallo real'))).toBe('Fallo real');
    expect(messageOf('otra cosa')).toBe('Ocurrió un error inesperado.');
  });
});
