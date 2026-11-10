package com.salon.gestion.infrastructure.adapter.graphql;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.salon.gestion.infrastructure.adapter.erp.ErpServicesClient;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Adaptador de Entrada GraphQL: puerta del ERP (Backend for Frontend). El módulo de gestión empresarial
 * habla solo GraphQL; estas operaciones las atienden otros microservicios y aquí se reenvían con el token
 * de la persona. El rol se revisa aquí y otra vez en cada servicio.
 */
@Controller
public class ErpGatewayGraphQLController {

    private static final int MAX_AUDIO_BYTES = 10 * 1024 * 1024;

    private final ErpServicesClient services;
    private final ObjectMapper json;

    public ErpGatewayGraphQLController(ErpServicesClient services, ObjectMapper json) {
        this.services = services;
        // Los servicios pueden agregar campos sin romper el ERP
        this.json = json.copy().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public record ModerationReport(String reason) {
    }

    public record ModerationPost(String id, String authorName, String title, String description, String imageUrl,
                                 String status, String moderationReason, List<ModerationReport> reports) {
        public ModerationPost {
            reports = reports == null ? List.of() : reports;
        }
    }

    public record CounterBooking(String sagaId, String status, String appointmentId, String serviceName,
                                 Integer amountToPayCents, String failureReason, String clientId, String paymentMethod) {
    }

    public record CounterBookingInput(String clientId, String clientName, String clientEmail, String serviceId,
                                      String stylistId, String appointmentDate, String paymentMethod) {
    }

    public record McpTool(String name, String description) {
    }

    public record McpToolResult(boolean isError, String text, String structuredContentJson) {
    }

    // --- Moderación de la comunidad (ms-asesoria) ---

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @QueryMapping
    public List<ModerationPost> moderationQueue() {
        return List.of(json.convertValue(services.asesoria("GET", "/community/moderation/queue", null), ModerationPost[].class));
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public boolean hidePost(@Argument String id, @Argument String reason) {
        services.asesoria("POST", "/community/" + segment(id) + "/hide", Map.of("reason", reason));
        return true;
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public boolean restorePost(@Argument String id) {
        services.asesoria("POST", "/community/" + segment(id) + "/restore", Map.of());
        return true;
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public boolean deletePost(@Argument String id) {
        services.asesoria("DELETE", "/community/" + segment(id), null);
        return true;
    }

    // --- Cobro en el mostrador (orquestador SAGA) ---

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    @MutationMapping
    public CounterBooking startCounterBooking(@Argument CounterBookingInput input, @Argument String idempotencyKey) {
        return json.convertValue(services.saga("POST", "/counter/bookings", input, idempotencyKey), CounterBooking.class);
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    @MutationMapping
    public boolean payCounterBooking(@Argument String sagaId) {
        services.saga("POST", "/counter/bookings/" + segment(sagaId) + "/pay", null, null);
        return true;
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    @MutationMapping
    public boolean voidCounterBooking(@Argument String sagaId) {
        services.saga("POST", "/counter/bookings/" + segment(sagaId) + "/void", null, null);
        return true;
    }

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST')")
    @QueryMapping
    public CounterBooking counterBooking(@Argument String sagaId) {
        return json.convertValue(services.saga("GET", "/bookings/" + segment(sagaId), null, null), CounterBooking.class);
    }

    // --- Comprobante (CRM), voz (ms-ia) y agentes (Servidor MCP) ---

    @PreAuthorize("hasAnyRole('ADMIN','RECEPTIONIST','STYLIST')")
    @QueryMapping
    public String invoiceReceipt(@Argument String invoiceId) {
        return services.receipt(invoiceId);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST')")
    @MutationMapping
    public String transcribeAudio(@Argument String audioBase64, @Argument String mimeType) {
        byte[] audio;
        try {
            audio = Base64.getDecoder().decode(audioBase64);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("El audio no está en base64.");
        }
        if (audio.length == 0 || audio.length > MAX_AUDIO_BYTES) {
            throw new IllegalArgumentException("El audio debe pesar entre 1 byte y 10 MB.");
        }
        return services.transcribe(audio, mimeType);
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST','RECEPTIONIST')")
    @QueryMapping
    public List<McpTool> mcpTools() {
        return List.of(json.convertValue(services.mcp("tools/list", Map.of()).path("tools"), McpTool[].class));
    }

    @PreAuthorize("hasAnyRole('ADMIN','STYLIST','RECEPTIONIST')")
    @MutationMapping
    public McpToolResult callMcpTool(@Argument String name, @Argument String argumentsJson) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("name", name);
        params.put("arguments", parseArguments(argumentsJson));
        JsonNode result = services.mcp("tools/call", params);
        JsonNode structured = result.path("structuredContent");
        return new McpToolResult(
                result.path("isError").asBoolean(false),
                result.path("content").path(0).path("text").asText(null),
                structured.isMissingNode() || structured.isNull() ? null : structured.toString());
    }

    private Object parseArguments(String argumentsJson) {
        if (argumentsJson == null || argumentsJson.isBlank()) return Map.of();
        try {
            JsonNode arguments = json.readTree(argumentsJson);
            if (!arguments.isObject()) throw new IllegalArgumentException("Los argumentos deben ser un objeto JSON.");
            return arguments;
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Los argumentos no son JSON válido.");
        }
    }

    /** Un identificador va como un solo tramo de la ruta: no puede cambiar a qué recurso se llama. */
    private static String segment(String id) {
        return URLEncoder.encode(id, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
