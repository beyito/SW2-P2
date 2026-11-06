import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Solo los microfrontends de la plataforma pueden invocar la API desde el navegador
  app.enableCors({
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  const port = process.env.PORT || 3100;
  await app.listen(port);
  console.log(`[ms-asesoria] Microservicio escuchando en http://localhost:${port}`);
}
bootstrap();
