import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { from, Observable, of, switchMap, tap } from 'rxjs';
import { CONDITION_FAILED, DynamoHttpClient } from '../../adapters/outbound/dynamo/dynamo-http.client';

const TABLE = 'IdempotencyKeys';
const ONE_DAY = 86400;

/**
 * Idempotencia con Idempotency-Key (RNF-04). Corre después del guard de autenticación
 * y limita la llave al usuario, para que nadie pueda leer la respuesta guardada de otro.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly dynamo: DynamoHttpClient) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const header = request.headers?.['idempotency-key'] as string | undefined;

    if (!header || request.method !== 'POST' || !request.user) {
      return next.handle();
    }

    const key = `${request.user.subject}:${header}`;
    const hash = crypto.createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

    return from(this.reserve(key, hash)).pipe(
      switchMap((previous) => {
        if (previous !== null) {
          http.getResponse().setHeader('X-Idempotent-Replay', 'true');
          return of(previous);
        }
        return next.handle().pipe(
          tap({
            next: (body) => void this.complete(key, hash, body).catch(() => this.release(key)),
            error: () => void this.release(key).catch(() => undefined),
          }),
        );
      }),
    );
  }

  /** Reserva la llave de forma atómica; devuelve la respuesta previa si ya se completó. */
  private async reserve(key: string, hash: string): Promise<unknown | null> {
    const result = await this.dynamo.call('PutItem', {
      TableName: TABLE,
      Item: {
        idempotencyKey: { S: key },
        status: { S: 'PENDING' },
        requestPayloadHash: { S: hash },
        ttl: { N: String(Math.floor(Date.now() / 1000) + ONE_DAY) },
      },
      ConditionExpression: 'attribute_not_exists(idempotencyKey)',
    });
    if (!String(result.__type).includes(CONDITION_FAILED)) {
      return null;
    }

    const { Item } = await this.dynamo.call('GetItem', {
      TableName: TABLE,
      ConsistentRead: true,
      Key: { idempotencyKey: { S: key } },
    });
    if (Item?.requestPayloadHash?.S !== hash) {
      throw new UnprocessableEntityException('La Idempotency-Key ya se usó con un contenido diferente.');
    }
    if (Item?.status?.S !== 'COMPLETED') {
      throw new ConflictException('La solicitud con esta Idempotency-Key aún se está procesando.');
    }
    return JSON.parse(Item.responseBody.S);
  }

  private complete(key: string, hash: string, body: unknown): Promise<unknown> {
    return this.dynamo.call('PutItem', {
      TableName: TABLE,
      Item: {
        idempotencyKey: { S: key },
        status: { S: 'COMPLETED' },
        requestPayloadHash: { S: hash },
        responseBody: { S: JSON.stringify(body ?? null) },
        ttl: { N: String(Math.floor(Date.now() / 1000) + ONE_DAY) },
      },
    });
  }

  /** Si la operación falla, libera la llave para permitir un reintento legítimo. */
  private release(key: string): Promise<unknown> {
    return this.dynamo.call('DeleteItem', { TableName: TABLE, Key: { idempotencyKey: { S: key } } });
  }
}
