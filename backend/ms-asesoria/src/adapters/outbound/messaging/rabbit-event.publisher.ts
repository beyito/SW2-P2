import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { IEventPublisher } from '../../../ports/outbound/event-publisher.port';

const EXCHANGE = 'salon.saga';

/**
 * Adaptador de salida hacia RabbitMQ. Si el bus no responde solo se registra:
 * la moderación ya quedó guardada y el aviso es un complemento.
 */
@Injectable()
export class RabbitEventPublisher implements IEventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(RabbitEventPublisher.name);
  private connection: Promise<amqp.ChannelModel> | null = null;

  async publish(routingKey: string, body: Record<string, unknown>): Promise<void> {
    try {
      const connection = await this.connect();
      const channel = await connection.createConfirmChannel();
      try {
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(body)), {
          contentType: 'application/json',
          persistent: true,
        });
        await channel.waitForConfirms();
      } finally {
        await channel.close();
      }
    } catch (error) {
      this.connection = null;
      this.logger.error(`No se pudo publicar ${routingKey}: ${(error as Error).message}`);
    }
  }

  private connect(): Promise<amqp.ChannelModel> {
    if (!this.connection) {
      const url = process.env.RABBITMQ_URL || 'amqp://rabbit_admin:rabbit_secret_pass@localhost:5672';
      this.connection = amqp.connect(url).then((connection) => {
        const reset = () => {
          this.connection = null;
        };
        connection.on('close', reset);
        connection.on('error', reset);
        return connection;
      });
    }
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      const connection = await this.connection.catch(() => null);
      await connection?.close().catch(() => undefined);
    }
  }
}
