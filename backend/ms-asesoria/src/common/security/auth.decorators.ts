import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'ADMIN' | 'STYLIST' | 'CLIENT';

/** Identidad extraída del token validado; nunca del cuerpo de la petición. */
export interface AuthenticatedUser {
  subject: string;
  /** Identificador de negocio del usuario (cliente, estilista o administrador). */
  id: string;
  name: string;
  roles: string[];
  sessionId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';

/** Marca una ruta como accesible sin token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exige que el usuario tenga al menos uno de los roles indicados. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Inyecta en el controlador el usuario autenticado. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedUser => context.switchToHttp().getRequest().user,
);

/** Personal del salón con acceso a datos de cualquier cliente. */
export const isStaff = (user: AuthenticatedUser): boolean =>
  user.roles.includes('ADMIN') || user.roles.includes('STYLIST');
