package com.salon.gestion.infrastructure.adapter.erp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * Adaptador de Salida de la puerta GraphQL del ERP: llama a los demás microservicios (asesoría, orquestador,
 * IA, Servidor MCP y CRM) con el token de quien hizo la petición. Cada servicio vuelve a validar su rol.
 */
@Component
public class ErpServicesClient {

    private static final Duration TIMEOUT = Duration.ofSeconds(60);

    // HTTP/1.1: sin cifrar, el cliente de Java intenta subir a HTTP/2 y uvicorn (ms-ia) rechaza esa
    // petición cuando lleva cuerpo, como el audio de la voz
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final ObjectMapper json;
    private final String asesoriaUrl;
    private final String sagaUrl;
    private final String iaUrl;
    private final String mcpUrl;
    private final String crmBaseUrl;

    public ErpServicesClient(
            ObjectMapper json,
            @Value("${salon.erp.asesoria-url}") String asesoriaUrl,
            @Value("${salon.erp.saga-url}") String sagaUrl,
            @Value("${salon.erp.ia-url}") String iaUrl,
            @Value("${salon.erp.mcp-url}") String mcpUrl,
            @Value("${salon.erp.crm-base-url}") String crmBaseUrl) {
        this.json = json;
        this.asesoriaUrl = asesoriaUrl;
        this.sagaUrl = sagaUrl;
        this.iaUrl = iaUrl;
        this.mcpUrl = mcpUrl;
        this.crmBaseUrl = crmBaseUrl;
    }

    public JsonNode asesoria(String method, String path, Object body) {
        return readJson(send(jsonRequest(asesoriaUrl + path, method, body)));
    }

    public JsonNode saga(String method, String path, Object body, String idempotencyKey) {
        HttpRequest.Builder request = jsonRequest(sagaUrl + path, method, body);
        if (idempotencyKey != null) {
            request.header("Idempotency-Key", idempotencyKey);
        }
        return readJson(send(request));
    }

    /** Whisper en ms-ia recibe el audio como formulario multipart, igual que antes desde el navegador. */
    public String transcribe(byte[] audio, String mimeType) {
        String boundary = "salon-" + UUID.randomUUID();
        ByteArrayOutputStream form = new ByteArrayOutputStream();
        form.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"pregunta\"\r\n"
                + "Content-Type: " + (mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType) + "\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8));
        form.writeBytes(audio);
        form.writeBytes(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        HttpRequest.Builder request = authorized(iaUrl + "/speech/transcribe")
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(form.toByteArray()));
        return readJson(send(request)).path("text").asText("");
    }

    /** Llamada JSON-RPC al Servidor MCP; devuelve el campo "result". */
    public JsonNode mcp(String method, Map<String, Object> params) {
        Map<String, Object> rpc = Map.of("jsonrpc", "2.0", "id", UUID.randomUUID().toString(), "method", method, "params", params);
        HttpRequest.Builder request = jsonRequest(mcpUrl, "POST", rpc).header("Accept", "application/json, text/event-stream");
        JsonNode body = readJson(send(request));
        if (body.hasNonNull("error")) {
            throw new ErpServiceException(400, body.path("error").path("message").asText("El Servidor MCP rechazó la petición."));
        }
        return body.path("result");
    }

    public String receipt(String invoiceId) {
        String url = crmBaseUrl + "/api/invoices/" + URLEncoder.encode(invoiceId, StandardCharsets.UTF_8) + "/comprobante";
        return send(authorized(url).GET()).body();
    }

    private HttpRequest.Builder jsonRequest(String url, String method, Object body) {
        HttpRequest.Builder request = authorized(url);
        if (body == null) {
            return request.method(method, HttpRequest.BodyPublishers.noBody());
        }
        try {
            return request.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        } catch (IOException error) {
            throw new IllegalArgumentException("Datos no válidos para el servicio.");
        }
    }

    private HttpRequest.Builder authorized(String url) {
        return HttpRequest.newBuilder(URI.create(url)).timeout(TIMEOUT).header("Authorization", "Bearer " + currentToken());
    }

    private HttpResponse<String> send(HttpRequest.Builder request) {
        HttpResponse<String> response;
        try {
            response = http.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new ErpServiceException(503, "El servicio no está disponible. Intente de nuevo en un momento.");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ErpServiceException(503, "La petición se interrumpió.");
        }
        if (response.statusCode() >= 400) {
            throw new ErpServiceException(response.statusCode(), messageOf(response));
        }
        return response;
    }

    private JsonNode readJson(HttpResponse<String> response) {
        try {
            return response.body().isBlank() ? json.createObjectNode() : json.readTree(response.body());
        } catch (IOException error) {
            throw new ErpServiceException(502, "El servicio respondió algo que no es JSON.");
        }
    }

    /** El mensaje real del servicio: NestJS usa "message", FastAPI "detail.message". */
    private String messageOf(HttpResponse<String> response) {
        try {
            JsonNode body = json.readTree(response.body());
            String message = body.path("message").isTextual() ? body.path("message").asText()
                    : body.path("detail").path("message").asText(body.path("detail").asText(""));
            if (!message.isBlank()) return message;
        } catch (IOException ignored) {
            // No era JSON: se usa el código
        }
        return "El servicio respondió " + response.statusCode() + ".";
    }

    private static String currentToken() {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token) {
            return token.getToken().getTokenValue();
        }
        throw new ErpServiceException(401, "Su sesión terminó.");
    }
}
