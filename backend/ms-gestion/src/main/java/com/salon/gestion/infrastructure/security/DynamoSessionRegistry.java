package com.salon.gestion.infrastructure.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;

/**
 * Adaptador del registro de sesiones sobre la tabla ActiveUserSessions de DynamoDB Local.
 */
@Component
public class DynamoSessionRegistry implements SessionRegistry {

    private static final String TABLE = "ActiveUserSessions";
    private static final String CONDITION_FAILED = "ConditionalCheckFailedException";
    private static final long EIGHT_HOURS = 28_800L;

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String endpoint;

    public DynamoSessionRegistry(@Value("${salon.security.dynamodb-endpoint}") String endpoint) {
        this.endpoint = endpoint;
    }

    @Override
    public boolean isRevoked(String sessionId) {
        return getItem("revoked#" + sessionId).has("Item");
    }

    @Override
    public Optional<ActiveSession> findActive(String userId) {
        JsonNode item = getItem(userId).path("Item");
        if (item.isMissingNode()) {
            return Optional.empty();
        }
        return Optional.of(new ActiveSession(
                item.path("sessionId").path("S").asText(),
                item.path("loginTimestamp").path("N").asLong()));
    }

    @Override
    public boolean claimActive(String userId, String sessionId, long authTime) {
        String time = Long.toString(authTime);
        JsonNode response = call("PutItem", Map.of(
                "TableName", TABLE,
                "Item", Map.of(
                        "userId", Map.of("S", userId),
                        "sessionId", Map.of("S", sessionId),
                        "loginTimestamp", Map.of("N", time),
                        "ttl", Map.of("N", Long.toString(authTime + EIGHT_HOURS))),
                "ConditionExpression",
                "attribute_not_exists(userId) OR loginTimestamp < :t OR sessionId = :s",
                "ExpressionAttributeValues", Map.of(
                        ":t", Map.of("N", time),
                        ":s", Map.of("S", sessionId))));
        return !response.path("__type").asText().contains(CONDITION_FAILED);
    }

    private JsonNode getItem(String key) {
        return call("GetItem", Map.of(
                "TableName", TABLE,
                "ConsistentRead", true,
                "Key", Map.of("userId", Map.of("S", key))));
    }

    private JsonNode call(String target, Map<String, Object> payload) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "application/x-amz-json-1.0")
                    .header("X-Amz-Target", "DynamoDB_20120810." + target)
                    .header("Authorization",
                            "AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, "
                                    + "SignedHeaders=host, Signature=local")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            JsonNode body = mapper.readTree(response.body());
            boolean conditionFailed = body.path("__type").asText().contains(CONDITION_FAILED);
            if (response.statusCode() != 200 && !conditionFailed) {
                throw new IllegalStateException("DynamoDB respondió " + response.statusCode());
            }
            return body;
        } catch (IOException e) {
            throw new IllegalStateException("DynamoDB no disponible", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Consulta a DynamoDB interrumpida", e);
        }
    }
}
