package com.salon.gestion.infrastructure.adapter.erp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.salon.gestion.infrastructure.adapter.graphql.ErpGatewayGraphQLController;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Puerta GraphQL del ERP contra un servidor HTTP real en memoria que hace de asesoría, orquestador,
 * IA, Servidor MCP y CRM: se comprueba qué recibe cada servicio y qué devuelve la puerta.
 */
class ErpGatewayTest {

    private final ObjectMapper json = new ObjectMapper();
    private final Map<String, String> received = new ConcurrentHashMap<>();
    private HttpServer server;
    private ErpGatewayGraphQLController gateway;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getRawPath();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            received.put(exchange.getRequestMethod() + " " + path, body);
            received.put("auth", String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
            received.put("idem", String.valueOf(exchange.getRequestHeaders().getFirst("Idempotency-Key")));
            received.put("type", String.valueOf(exchange.getRequestHeaders().getFirst("Content-Type")));
            received.put("upgrade", String.valueOf(exchange.getRequestHeaders().getFirst("Upgrade")));
            received.put("protocol", exchange.getProtocol());
            int status = 200;
            String answer = "{}";
            if (path.equals("/asesoria/community/moderation/queue")) {
                answer = "[{\"id\":\"p1\",\"title\":\"Look\",\"status\":\"HIDDEN\",\"reports\":[{\"reason\":\"spam\"}],\"campoNuevo\":1}]";
            } else if (path.startsWith("/saga/counter/bookings") && body.contains("clientId")) {
                answer = "{\"sagaId\":\"s-1\",\"status\":\"RESERVING_APPOINTMENT\",\"amountToPayCents\":4500}";
            } else if (path.equals("/saga/bookings/s-roto")) {
                status = 409;
                answer = "{\"message\":\"El turno ya no está libre.\"}";
            } else if (path.equals("/ia/speech/transcribe")) {
                answer = "{\"text\":\"¿qué insumos debo reponer?\"}";
            } else if (path.equals("/mcp")) {
                answer = body.contains("tools/list")
                        ? "{\"jsonrpc\":\"2.0\",\"result\":{\"tools\":[{\"name\":\"generar_reporte\",\"description\":\"Reportes\",\"inputSchema\":{}}]}}"
                        : "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"structuredContent\":{\"totalFilas\":2}}}";
            } else if (path.startsWith("/crm/api/invoices/")) {
                answer = "<html>Comprobante</html>";
            }
            byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        ErpServicesClient client = new ErpServicesClient(json, base + "/asesoria", base + "/saga", base + "/ia", base + "/mcp", base + "/crm");
        gateway = new ErpGatewayGraphQLController(client, json);
        Jwt jwt = new Jwt("token-de-la-persona", Instant.now(), Instant.now().plusSeconds(300), Map.of("alg", "RS256"), Map.of("sub", "adm"));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        SecurityContextHolder.clearContext();
    }

    @Test
    void reenviaElTokenDeLaPersonaYConvierteLaModeracion() {
        List<ErpGatewayGraphQLController.ModerationPost> queue = gateway.moderationQueue();
        assertThat(received.get("auth")).isEqualTo("Bearer token-de-la-persona");
        assertThat(queue).singleElement().satisfies(post -> {
            assertThat(post.status()).isEqualTo("HIDDEN");
            assertThat(post.reports()).extracting(ErpGatewayGraphQLController.ModerationReport::reason).containsExactly("spam");
        });
    }

    @Test
    void unIdentificadorNoPuedeCambiarLaRutaDelServicio() {
        gateway.hidePost("../../admin", "Ofensivo");
        assertThat(received).containsKey("POST /asesoria/community/..%2F..%2Fadmin/hide");
        assertThat(received.get("POST /asesoria/community/..%2F..%2Fadmin/hide")).contains("Ofensivo");
    }

    @Test
    void elMostradorEnviaLaLlaveDeIdempotencia() {
        ErpGatewayGraphQLController.CounterBooking booking = gateway.startCounterBooking(
                new ErpGatewayGraphQLController.CounterBookingInput("cli-1", "Camila", null, "srv-03", "sty-101", "2026-11-10T10:00:00", "CASH"),
                "llave-1");
        assertThat(received.get("idem")).isEqualTo("llave-1");
        assertThat(booking.sagaId()).isEqualTo("s-1");
        assertThat(booking.amountToPayCents()).isEqualTo(4500);
    }

    @Test
    void elErrorDelServicioLlegaConSuMensajeYCodigo() {
        assertThatThrownBy(() -> gateway.counterBooking("s-roto"))
                .isInstanceOf(ErpServiceException.class)
                .hasMessage("El turno ya no está libre.")
                .satisfies(error -> assertThat(((ErpServiceException) error).status()).isEqualTo(409));
    }

    @Test
    void laVozViajaComoMultipartAWhisper() {
        String audio = Base64.getEncoder().encodeToString(new byte[]{1, 2, 3});
        assertThat(gateway.transcribeAudio(audio, "audio/webm")).isEqualTo("¿qué insumos debo reponer?");
        assertThat(received.get("type")).startsWith("multipart/form-data; boundary=");
        // Sin intento de subir a HTTP/2: uvicorn rechaza esa petición cuando lleva cuerpo
        assertThat(received.get("protocol")).isEqualTo("HTTP/1.1");
        assertThat(received.get("upgrade")).isEqualTo("null");
        assertThatThrownBy(() -> gateway.transcribeAudio("no es base64 %%", null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void lasHerramientasMcpPasanPorJsonRpc() throws Exception {
        assertThat(gateway.mcpTools()).extracting(ErpGatewayGraphQLController.McpTool::name).containsExactly("generar_reporte");

        ErpGatewayGraphQLController.McpToolResult result = gateway.callMcpTool("generar_reporte", "{\"entidad\":\"citas\"}");
        JsonNode rpc = json.readTree(received.get("POST /mcp"));
        assertThat(rpc.path("method").asText()).isEqualTo("tools/call");
        assertThat(rpc.path("params").path("arguments").path("entidad").asText()).isEqualTo("citas");
        assertThat(result.isError()).isFalse();
        assertThat(json.readTree(result.structuredContentJson()).path("totalFilas").asInt()).isEqualTo(2);
        assertThatThrownBy(() -> gateway.callMcpTool("x", "[1,2]")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void elComprobanteLlegaComoHtml() {
        assertThat(gateway.invoiceReceipt("inv 1")).isEqualTo("<html>Comprobante</html>");
        assertThat(received).containsKey("GET /crm/api/invoices/inv+1/comprobante");
    }
}
