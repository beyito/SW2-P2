/**
 * Punto de entrada del orquestador SAGA (CU-10, RF-07, RNF-03, RNF-04).
 */
const { createApi } = require('./http-api');
const { DynamoClient, IdempotencyStore, SagaRepository } = require('./dynamo-stores');
const { SagaMessaging } = require('./messaging');
const { SagaRunner } = require('./saga-runner');
const { DynamoSessionRegistry, createAuthenticator, createKeycloakVerifier } = require('./security');
const { StripeGateway } = require('./stripe-gateway');

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

async function main() {
  const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
  const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/salon';

  const messaging = new SagaMessaging(requireEnv('RABBITMQ_URL'));
  await messaging.connect();

  const dynamo = new DynamoClient(dynamoEndpoint);
  const repository = new SagaRepository(dynamo);
  const gateway = new StripeGateway({
    secretKey: requireEnv('STRIPE_SECRET_KEY'),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const runner = new SagaRunner({
    repository,
    publisher: messaging,
    payments: gateway,
    paymentTimeoutMs: Number(process.env.SAGA_PAYMENT_TIMEOUT_MS) || FIFTEEN_MINUTES_MS,
  });

  await messaging.consumeEvents((event, options) => runner.handle(event, options));

  const api = createApi({
    authenticate: createAuthenticator({
      verify: createKeycloakVerifier({
        issuer,
        audience: process.env.KEYCLOAK_AUDIENCE || 'salon-api',
        jwksUri: process.env.KEYCLOAK_JWKS_URI || `${issuer}/protocol/openid-connect/certs`,
      }),
      sessions: new DynamoSessionRegistry(dynamoEndpoint),
    }),
    runner,
    repository,
    idempotency: new IdempotencyStore(dynamo),
    gateway,
    publisher: messaging,
    publishableKey: requireEnv('STRIPE_PUBLISHABLE_KEY'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  });

  const port = Number(process.env.PORT) || 4100;
  api.listen(port, () => console.log(`[SAGA] Orquestador activo en el puerto ${port}`));
}

main().catch((error) => {
  console.error('[SAGA] No se pudo iniciar el orquestador:', error.message);
  process.exit(1);
});
