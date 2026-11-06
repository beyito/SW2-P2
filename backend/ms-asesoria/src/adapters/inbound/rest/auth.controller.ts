import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ISessionRegistry, SESSION_REGISTRY } from '../../../ports/outbound/session-registry.port';
import { AuthenticatedUser, CurrentUser } from '../../../common/security/auth.decorators';

/**
 * Sesión del usuario autenticado (CU-01, CU-02).
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(SESSION_REGISTRY) private readonly sessions: ISessionRegistry) {}

  /** Confirma que la sesión sigue vigente y devuelve la identidad del token. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, name: user.name, roles: user.roles };
  }

  /** Revoca la sesión: sus tokens dejan de valer en todos los servicios. */
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<{ closed: boolean }> {
    if (user.sessionId) {
      await this.sessions.revoke(user.sessionId);
    }
    return { closed: true };
  }
}
