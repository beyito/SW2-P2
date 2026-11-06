import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, JWTPayload, jwtVerify, JWTVerifyGetKey } from 'jose';

export const TOKEN_VERIFIER = Symbol('ITokenVerifier');

export interface ITokenVerifier {
  verify(token: string): Promise<JWTPayload>;
}

/**
 * Verifica firma RS256, emisor, audiencia y vigencia de los tokens de Keycloak.
 */
@Injectable()
export class KeycloakTokenVerifier implements ITokenVerifier {
  private readonly keys: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor() {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/salon';
    const jwksUri = process.env.KEYCLOAK_JWKS_URI || `${issuer}/protocol/openid-connect/certs`;
    this.issuer = issuer;
    this.audience = process.env.KEYCLOAK_AUDIENCE || 'salon-api';
    this.keys = createRemoteJWKSet(new URL(jwksUri));
  }

  async verify(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['RS256'],
    });
    return payload;
  }
}
