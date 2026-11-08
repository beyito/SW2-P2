package com.salon.gestion.infrastructure.security;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Firma SigV4 de las llamadas a DynamoDB. Las firmas de referencia se calcularon con botocore,
 * el SDK oficial de AWS; la primera es el ejemplo de su documentación.
 */
class AwsSigV4Test {

    private static final String BODY = "{\"TableName\":\"IdempotencyKeys\",\"Key\":{\"idempotencyKey\":{\"S\":\"k1\"}}}";
    private static final Map<String, String> DYNAMO_HEADERS = Map.of(
            "Content-Type", "application/x-amz-json-1.0",
            "X-Amz-Target", "DynamoDB_20120810.GetItem");

    private static AwsSigV4.Credentials credentials(String token) {
        return new AwsSigV4.Credentials("AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", token, "us-east-1");
    }

    private static String signatureOf(Map<String, String> headers) {
        return headers.get("Authorization").split("Signature=")[1];
    }

    @Test
    void coincideConElEjemploOficialDeAws() {
        Map<String, String> headers = AwsSigV4.sign("GET",
                URI.create("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
                Map.of("Content-Type", "application/x-www-form-urlencoded; charset=utf-8"), "",
                "iam", credentials(null), Instant.parse("2015-08-30T12:36:00Z"));
        assertEquals("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7", signatureOf(headers));
        assertTrue(headers.get("Authorization").contains("SignedHeaders=content-type;host;x-amz-date,"));
        // Java pone el Host por su cuenta y no permite fijarlo
        assertFalse(headers.containsKey("Host"));
    }

    @Test
    void firmaUnaPeticionADynamoIgualQueBotocore() {
        Map<String, String> headers = AwsSigV4.sign("POST", URI.create("https://dynamodb.us-east-1.amazonaws.com/"),
                DYNAMO_HEADERS, BODY, "dynamodb", credentials(null), Instant.parse("2026-11-08T12:00:00Z"));
        assertEquals("0060c4fedcd6b015779df0310009d61d2a0292ab4a73876a4658dbcfd865302b", signatureOf(headers));
        assertEquals("20261108T120000Z", headers.get("X-Amz-Date"));
    }

    @Test
    void incluyeTokenDeSesionYPuertoComoDynamoLocal() {
        Map<String, String> headers = AwsSigV4.sign("POST", URI.create("http://dynamodb-local:8000"),
                DYNAMO_HEADERS, BODY, "dynamodb", credentials("TOKENDEPRUEBA"), Instant.parse("2026-11-08T12:00:00Z"));
        assertEquals("1cf0677b1ea0123acd9eb58375af484969150eac21329afdc760541e51275ba3", signatureOf(headers));
        assertEquals("TOKENDEPRUEBA", headers.get("X-Amz-Security-Token"));
    }

    @Test
    void sinCredencialesUsaLasDeRellenoDeDynamoLocal() {
        assertEquals(new AwsSigV4.Credentials("local", "local", null, "us-east-1"),
                AwsSigV4.Credentials.fromEnv(Map.of()));
        assertEquals("us-east-2", AwsSigV4.Credentials.fromEnv(Map.of("AWS_REGION", "us-east-2")).region());
    }
}
