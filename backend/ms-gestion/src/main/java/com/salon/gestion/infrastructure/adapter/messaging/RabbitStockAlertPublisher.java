package com.salon.gestion.infrastructure.adapter.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.salon.gestion.domain.repository.StockAlertPublisher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Publica la alerta de stock crítico (RF-03). Si RabbitMQ no responde solo se registra:
 * el movimiento de inventario ya se guardó y el panel sigue mostrando el nivel crítico.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RabbitStockAlertPublisher implements StockAlertPublisher {

    private static final String ROUTING_KEY = "inventory.stock.critical";

    private final RabbitTemplate rabbit;
    private final ObjectMapper mapper;
    private final StockItemNames stockItemNames;

    @Override
    public void publishCritical(List<String> itemCodes) {
        try {
            MessageProperties properties = new MessageProperties();
            properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
            properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            byte[] body = mapper.writeValueAsBytes(stockItemNames.alert(itemCodes));
            rabbit.send(SagaMessagingConfig.EXCHANGE, ROUTING_KEY, MessageBuilder.withBody(body).andProperties(properties).build());
        } catch (AmqpException | JsonProcessingException e) {
            log.error("No se pudo publicar la alerta de stock crítico de {}: {}", itemCodes, e.getMessage());
        }
    }
}
