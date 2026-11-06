import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ISessionRegistry } from '../../ports/outbound/session-registry.port';
import { REQUIRED_ROLES, IS_PUBLIC } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { ITokenVerifier } from './token-verifier';

describe('AuthGuard (RF-01, CU-01, CU-02)', () => {
  let verifier: jest.Mocked<ITokenVerifier>;
  let sessions: jest.Mocked<ISessionRegistry>;
  let reflector: Reflector;
  let guard: AuthGuard;

  const contextWith = (authorization?: string): { context: ExecutionContext; request: any } => {
    const request: any = { headers: { authorization } };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const metadata = (values: Record<string, unknown>) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => values[key as string]);

  const claims = (role: string, sid: string | undefined = 's1', authTime = 100) => ({
    sub: 'usuario-1',
    salon_id: 'cli-001',
    name: 'Camila',
    sid,
    auth_time: authTime,
    realm_access: { roles: [role] },
  });

  beforeEach(() => {
    verifier = { verify: jest.fn() };
    sessions = {
      isRevoked: jest.fn().mockResolvedValue(false),
      revoke: jest.fn(),
      findActive: jest.fn().mockResolvedValue(null),
      claimActive: jest.fn().mockResolvedValue(true),
    };
    reflector = new Reflector();
    guard = new AuthGuard(reflector, verifier, sessions);
  });

  it('permite rutas públicas sin token', async () => {
    metadata({ [IS_PUBLIC]: true });
    await expect(guard.canActivate(contextWith().context)).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rechaza con 401 si falta el token', async () => {
    await expect(guard.canActivate(contextWith().context)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza con 401 un token inválido', async () => {
    verifier.verify.mockRejectedValue(new Error('firma inválida'));
    await expect(guard.canActivate(contextWith('Bearer malo').context)).rejects.toThrow(UnauthorizedException);
  });

  it('expone la identidad del token en la petición', async () => {
    verifier.verify.mockResolvedValue(claims('CLIENT'));
    const { context, request } = contextWith('Bearer ok');
    await guard.canActivate(context);
    expect(request.user).toMatchObject({ id: 'cli-001', subject: 'usuario-1', roles: ['CLIENT'] });
  });

  it('rechaza con 403 un rol insuficiente', async () => {
    metadata({ [REQUIRED_ROLES]: ['ADMIN'] });
    verifier.verify.mockResolvedValue(claims('CLIENT'));
    await expect(guard.canActivate(contextWith('Bearer ok').context)).rejects.toThrow(ForbiddenException);
  });

  it('rechaza con 401 una sesión cerrada', async () => {
    verifier.verify.mockResolvedValue(claims('CLIENT'));
    sessions.isRevoked.mockResolvedValue(true);
    await expect(guard.canActivate(contextWith('Bearer ok').context)).rejects.toThrow(UnauthorizedException);
  });

  it('no aplica sesión única a clientes', async () => {
    verifier.verify.mockResolvedValue(claims('CLIENT'));
    await guard.canActivate(contextWith('Bearer ok').context);
    expect(sessions.findActive).not.toHaveBeenCalled();
  });

  it('un login de ADMIN más reciente reclama la sesión', async () => {
    verifier.verify.mockResolvedValue(claims('ADMIN', 's2', 200));
    sessions.findActive.mockResolvedValue({ sessionId: 's1', authTime: 100 });
    await expect(guard.canActivate(contextWith('Bearer ok').context)).resolves.toBe(true);
    expect(sessions.claimActive).toHaveBeenCalledWith('usuario-1', 's2', 200);
  });

  it('la sesión de ADMIN desplazada recibe 401', async () => {
    verifier.verify.mockResolvedValue(claims('ADMIN', 's1', 100));
    sessions.findActive.mockResolvedValue({ sessionId: 's2', authTime: 200 });
    await expect(guard.canActivate(contextWith('Bearer ok').context)).rejects.toThrow(UnauthorizedException);
  });

  it('una cuenta de servicio sin sesión no consulta el registro', async () => {
    verifier.verify.mockResolvedValue({ sub: 'agente', realm_access: { roles: ['ADMIN'] } });
    await expect(guard.canActivate(contextWith('Bearer ok').context)).resolves.toBe(true);
    expect(sessions.isRevoked).not.toHaveBeenCalled();
  });

  it('si el registro falla, rechaza el acceso', async () => {
    verifier.verify.mockResolvedValue(claims('CLIENT'));
    sessions.isRevoked.mockRejectedValue(new Error('caído'));
    await expect(guard.canActivate(contextWith('Bearer ok').context)).rejects.toThrow(UnauthorizedException);
  });
});
