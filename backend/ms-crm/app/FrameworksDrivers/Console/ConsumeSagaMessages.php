<?php

namespace App\FrameworksDrivers\Console;

use App\InterfaceAdapters\Messaging\SagaMessageHandler;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use PhpAmqpLib\Connection\AMQPStreamConnection;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;

/**
 * Worker: consume los eventos de pago y los comandos de la SAGA dirigidos al CRM.
 * Una sola cola conserva el orden: la factura siempre se crea antes que su reembolso.
 */
class ConsumeSagaMessages extends Command
{
    private const EXCHANGE = 'salon.saga';
    private const DEAD_LETTER_EXCHANGE = 'salon.saga.dlx';
    private const QUEUE = 'crm.saga.events';

    protected $signature = 'crm:consume-saga-messages';
    protected $description = 'Consume eventos y comandos de la SAGA destinados al CRM';

    public function handle(SagaMessageHandler $handler): int
    {
        $connection = new AMQPStreamConnection(
            env('RABBITMQ_HOST', 'localhost'),
            (int) env('RABBITMQ_PORT', 5672),
            env('RABBITMQ_USER', 'rabbit_admin'),
            env('RABBITMQ_PASSWORD', 'rabbit_secret_pass')
        );
        $channel = $connection->channel();
        $channel->confirm_select();

        $channel->exchange_declare(self::EXCHANGE, 'topic', false, true, false);
        $channel->exchange_declare(self::DEAD_LETTER_EXCHANGE, 'topic', false, true, false);
        $channel->queue_declare(self::QUEUE, false, true, false, false, false, new AMQPTable([
            'x-dead-letter-exchange' => self::DEAD_LETTER_EXCHANGE,
        ]));
        $channel->queue_bind(self::QUEUE, self::EXCHANGE, 'saga.completed');
        $channel->queue_bind(self::QUEUE, self::EXCHANGE, 'crm.command.#');
        $channel->basic_qos(0, 1, false);

        $channel->basic_consume(self::QUEUE, '', false, false, false, false, function (AMQPMessage $message) use ($handler, $channel) {
            $routingKey = $message->getRoutingKey();
            try {
                $replies = $handler->handle($routingKey, json_decode($message->getBody(), true, 512, JSON_THROW_ON_ERROR));

                // Primero se publica la respuesta: si algo falla, el mensaje se repite sin efectos dobles
                foreach ($replies as $reply) {
                    $channel->basic_publish(
                        new AMQPMessage(json_encode($reply['body']), [
                            'content_type' => 'application/json',
                            'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
                        ]),
                        self::EXCHANGE,
                        $reply['routingKey']
                    );
                }
                $channel->wait_for_pending_acks(5);
                $message->ack();
            } catch (\Throwable $error) {
                // Primer fallo: se reintenta una vez. Si se repite, va a la cola de mensajes muertos.
                Log::error("Error al procesar {$routingKey}: {$error->getMessage()}");
                $message->nack(!$message->isRedelivered());
            }
        });

        $this->info('Worker del CRM escuchando en ' . self::QUEUE);
        $channel->consume();

        return self::SUCCESS;
    }
}
