package com.salon.gestion.infrastructure.adapter.messaging;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Topología de RabbitMQ que usa ms-gestion en la SAGA. Debe coincidir con la del orquestador.
 */
@Configuration
public class SagaMessagingConfig {

    public static final String EXCHANGE = "salon.saga";
    public static final String COMMANDS_QUEUE = "gestion.saga.commands";
    private static final String DEAD_LETTER_EXCHANGE = "salon.saga.dlx";
    private static final String DEAD_LETTER_QUEUE = "saga.dead-letter";

    @Bean
    Declarables sagaTopology() {
        TopicExchange exchange = new TopicExchange(EXCHANGE);
        TopicExchange deadLetters = new TopicExchange(DEAD_LETTER_EXCHANGE);
        Queue commands = QueueBuilder.durable(COMMANDS_QUEUE).deadLetterExchange(DEAD_LETTER_EXCHANGE).build();
        Queue deadLetterQueue = QueueBuilder.durable(DEAD_LETTER_QUEUE).build();
        Binding commandsBinding = BindingBuilder.bind(commands).to(exchange).with("saga.command.#");
        Binding deadLetterBinding = BindingBuilder.bind(deadLetterQueue).to(deadLetters).with("#");
        return new Declarables(exchange, deadLetters, commands, deadLetterQueue, commandsBinding, deadLetterBinding);
    }
}
