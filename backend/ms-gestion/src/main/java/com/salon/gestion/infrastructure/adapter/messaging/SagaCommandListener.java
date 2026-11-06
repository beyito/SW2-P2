package com.salon.gestion.infrastructure.adapter.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.salon.gestion.application.usecase.BookingRejectedException;
import com.salon.gestion.application.usecase.BookingSagaUseCase;
import com.salon.gestion.domain.model.Appointment;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Adaptador de entrada: ejecuta los comandos de la SAGA y publica su resultado.
 * Publica después de confirmar la transacción; si eso falla, el mensaje se reintenta
 * y el caso de uso idempotente vuelve a responder sin repetir el cambio.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SagaCommandListener {

    private final BookingSagaUseCase booking;
    private final RabbitTemplate rabbit;
    private final ObjectMapper mapper;

    @RabbitListener(queues = SagaMessagingConfig.COMMANDS_QUEUE)
    public void onCommand(Message message) throws IOException {
        String routingKey = message.getMessageProperties().getReceivedRoutingKey();
        JsonNode command = mapper.readTree(message.getBody());
        String sagaId = command.path("sagaId").asText();
        log.info("Comando de SAGA {} para {}", routingKey, sagaId);

        switch (routingKey) {
            case "saga.command.appointment.reserve" -> reserveAppointment(sagaId, command);
            case "saga.command.inventory.reserve" -> reserveInventory(sagaId);
            case "saga.command.appointment.confirm" -> {
                booking.confirmAppointment(sagaId);
                publish("appointment.confirmed", Map.of("sagaId", sagaId));
            }
            case "saga.command.inventory.commit" -> commitInventory(sagaId);
            case "saga.command.inventory.release" -> {
                booking.releaseInventory(sagaId);
                publish("inventory.released", Map.of("sagaId", sagaId));
            }
            case "saga.command.appointment.cancel" -> {
                booking.cancelAppointment(sagaId, command.path("reason").asText("Compensación de SAGA"));
                publish("appointment.released", Map.of("sagaId", sagaId));
            }
            case "saga.command.appointment.cancel_paid" -> cancelPaidAppointment(sagaId);
            default -> log.warn("Comando desconocido: {}", routingKey);
        }
    }

    private void reserveAppointment(String sagaId, JsonNode command) {
        try {
            Appointment appointment = booking.reserveAppointment(
                    sagaId,
                    command.path("clientId").asText(),
                    command.path("stylistId").asText(),
                    command.path("serviceId").asText(),
                    command.path("appointmentDate").asText());
            publish("appointment.reserved", Map.of(
                    "sagaId", sagaId,
                    "appointmentId", appointment.getId(),
                    "serviceName", appointment.getServiceName(),
                    "amountCents", Math.round(appointment.getTotalPrice() * 100)));
        } catch (BookingRejectedException e) {
            publish("appointment.reserve_failed", Map.of("sagaId", sagaId, "reason", e.getReason()));
        } catch (DataIntegrityViolationException e) {
            // La restricción de exclusión detuvo una reserva simultánea del mismo turno
            publish("appointment.reserve_failed", Map.of("sagaId", sagaId, "reason", "SLOT_TAKEN"));
        }
    }

    private void reserveInventory(String sagaId) {
        try {
            booking.reserveInventory(sagaId);
            publish("inventory.reserved", Map.of("sagaId", sagaId));
        } catch (BookingRejectedException e) {
            publish("inventory.reserve_failed", Map.of("sagaId", sagaId, "reason", e.getReason()));
        }
    }

    private void commitInventory(String sagaId) {
        List<String> critical = booking.commitInventory(sagaId);
        publish("inventory.committed", Map.of("sagaId", sagaId));
        // RF-03: alerta de stock crítico para las automatizaciones
        if (!critical.isEmpty()) {
            send("inventory.stock.critical", Map.of("sagaId", sagaId, "items", critical));
        }
    }

    private void cancelPaidAppointment(String sagaId) {
        try {
            booking.cancelPaidAppointment(sagaId);
            publish("appointment.cancelled", Map.of("sagaId", sagaId));
        } catch (BookingRejectedException e) {
            publish("appointment.cancel_rejected", Map.of("sagaId", sagaId, "reason", e.getReason()));
        }
    }

    private void publish(String event, Map<String, Object> body) {
        send("saga.event." + event, body);
    }

    private void send(String routingKey, Map<String, Object> body) {
        try {
            MessageProperties properties = new MessageProperties();
            properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
            properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            rabbit.send(SagaMessagingConfig.EXCHANGE, routingKey,
                    MessageBuilder.withBody(mapper.writeValueAsBytes(body)).andProperties(properties).build());
        } catch (IOException e) {
            throw new IllegalStateException("No se pudo serializar el evento " + routingKey, e);
        }
    }
}
