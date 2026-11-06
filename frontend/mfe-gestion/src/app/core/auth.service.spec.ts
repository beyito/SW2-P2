import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { AuthService } from './auth.service';
import { setPlatform } from './platform';

const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '');
const token = (claims: object) => `${b64({ alg: 'none' })}.${b64(claims)}.firma`;

describe('AuthService', () => {
  let onSessionLost: Mock<() => void>;

  beforeEach(() => {
    onSessionLost = vi.fn<() => void>();
  });

  async function iniciar(claims: object) {
    await setPlatform({ getToken: async () => token(claims), onSessionLost });
    return new AuthService();
  }

  it('lee los roles y el identificador del token del Shell', async () => {
    const auth = await iniciar({ sub: 'abc', salon_id: 'adm-1', realm_access: { roles: ['ADMIN'] } });
    expect(auth.isAdmin()).toBe(true);
    expect(auth.userId()).toBe('adm-1');
    expect(auth.roles()).toEqual(['ADMIN']);
  });

  it('un cliente no es administrador', async () => {
    const auth = await iniciar({ sub: 'abc', realm_access: { roles: ['CLIENT'] } });
    expect(auth.isAdmin()).toBe(false);
    expect(auth.userId()).toBe('abc');
  });

  it('un token ilegible no otorga ningún rol', async () => {
    await setPlatform({ getToken: async () => 'no-es-un-token', onSessionLost });
    const auth = new AuthService();
    expect(auth.roles()).toEqual([]);
    expect(auth.isAdmin()).toBe(false);
  });

  it('cada petición pide un token vigente al Shell', async () => {
    let vuelta = 0;
    await setPlatform({ getToken: async () => `token-${++vuelta}`, onSessionLost });
    const auth = new AuthService();
    expect(await auth.freshToken()).toBe('token-2');
    expect(auth.token()).toBe('token-2');
  });

  it('avisa al Shell cuando la sesión terminó', async () => {
    const auth = await iniciar({ sub: 'abc' });
    auth.sessionLost();
    expect(onSessionLost).toHaveBeenCalled();
  });
});
