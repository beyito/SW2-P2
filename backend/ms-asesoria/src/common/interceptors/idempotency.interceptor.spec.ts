import { CallHandler, ConflictException, ExecutionContext, UnprocessableEntityException } from '@nestjs/common';
import * as crypto from 'crypto';
import { lastValueFrom, of, throwError } from 'rxjs';
import { CONDITION_FAILED, DynamoHttpClient } from '../../adapters/outbound/dynamo/dynamo-http.client';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor (RNF-04)', () => {
  const body = { name: 'Blazer' };
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

  let dynamo: { call: jest.Mock };
  let interceptor: IdempotencyInterceptor;
  let response: { setHeader: jest.Mock };

  const context = (overrides: Record<string, unknown> = {}): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          body,
          user: { subject: 'usuario-1' },
          headers: { 'idempotency-key': 'llave-1' },
          ...overrides,
        }),
        getResponse: () => response,
      }),
    }) as unknown as ExecutionContext;

  const handler = (result = of({ id: 'nuevo' })): CallHandler & { handle: jest.Mock } => ({
    handle: jest.fn().mockReturnValue(result),
  });

  /** Simula una llave ya existente en DynamoDB. */
  const existing = (item: Record<string, unknown>) =>
    dynamo.call.mockImplementation(async (target: string) =>
      target === 'PutItem' ? { __type: `com.amazonaws#${CONDITION_FAILED}` } : { Item: item },
    );

  beforeEach(() => {
    dynamo = { call: jest.fn().mockResolvedValue({}) };
    response = { setHeader: jest.fn() };
    interceptor = new IdempotencyInterceptor(dynamo as unknown as DynamoHttpClient);
  });

  it('sin llave ejecuta el controlador sin tocar DynamoDB', async () => {
    const next = handler();
    await lastValueFrom(interceptor.intercept(context({ headers: {} }), next));
    expect(next.handle).toHaveBeenCalled();
    expect(dynamo.call).not.toHaveBeenCalled();
  });

  it('reserva la llave limitada al usuario, de forma condicional', async () => {
    await lastValueFrom(interceptor.intercept(context(), handler()));
    expect(dynamo.call.mock.calls[0][1]).toMatchObject({
      Item: { idempotencyKey: { S: 'usuario-1:llave-1' }, status: { S: 'PENDING' } },
      ConditionExpression: 'attribute_not_exists(idempotencyKey)',
    });
  });

  it('un reintento devuelve la respuesta guardada sin ejecutar el controlador', async () => {
    existing({
      status: { S: 'COMPLETED' },
      requestPayloadHash: { S: hash },
      responseBody: { S: JSON.stringify({ id: 'previo' }) },
    });
    const next = handler();
    await expect(lastValueFrom(interceptor.intercept(context(), next))).resolves.toEqual({ id: 'previo' });
    expect(next.handle).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
  });

  it('rechaza con 422 la misma llave con otro contenido', async () => {
    existing({ status: { S: 'COMPLETED' }, requestPayloadHash: { S: 'otro' } });
    await expect(lastValueFrom(interceptor.intercept(context(), handler()))).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('rechaza con 409 mientras la solicitud original sigue en curso', async () => {
    existing({ status: { S: 'PENDING' }, requestPayloadHash: { S: hash } });
    await expect(lastValueFrom(interceptor.intercept(context(), handler()))).rejects.toThrow(ConflictException);
  });

  it('libera la llave si el controlador falla', async () => {
    const next = handler(throwError(() => new Error('fallo')) as any);
    await expect(lastValueFrom(interceptor.intercept(context(), next))).rejects.toThrow('fallo');
    expect(dynamo.call).toHaveBeenCalledWith('DeleteItem', expect.anything());
  });
});
