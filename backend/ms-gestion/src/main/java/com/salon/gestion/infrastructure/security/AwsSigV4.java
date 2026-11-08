package com.salon.gestion.infrastructure.security;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Firma de peticiones a AWS con Signature Version 4.
 * DynamoDB real la exige; DynamoDB Local acepta cualquier firma, así que el mismo código sirve en ambos.
 */
public final class AwsSigV4 {

    private static final DateTimeFormatter AMZ_DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private AwsSigV4() {
    }

    /** Credenciales de AWS; sessionToken puede ser nulo. */
    public record Credentials(String accessKeyId, String secretAccessKey, String sessionToken, String region) {

        /** Sin credenciales en el entorno se usan unas de relleno, válidas solo para DynamoDB Local. */
        public static Credentials fromEnv(Map<String, String> env) {
            return new Credentials(
                    orDefault(env.get("AWS_ACCESS_KEY_ID"), "local"),
                    orDefault(env.get("AWS_SECRET_ACCESS_KEY"), "local"),
                    orDefault(env.get("AWS_SESSION_TOKEN"), null),
                    orDefault(env.get("AWS_REGION"), orDefault(env.get("AWS_DEFAULT_REGION"), "us-east-1")));
        }

        private static String orDefault(String value, String fallback) {
            return value == null || value.isBlank() ? fallback : value;
        }
    }

    /**
     * Devuelve las cabeceras a enviar, sin Host: el cliente HTTP de Java la pone solo y con el mismo valor.
     * Las cabeceras recibidas deben ser todas las que se enviarán.
     */
    public static Map<String, String> sign(String method, URI uri, Map<String, String> headers, String body,
                                           String service, Credentials credentials, Instant now) {
        String amzDate = AMZ_DATE.format(now);
        String day = amzDate.substring(0, 8);
        Map<String, String> result = new LinkedHashMap<>(headers);
        result.put("X-Amz-Date", amzDate);
        if (credentials.sessionToken() != null) {
            result.put("X-Amz-Security-Token", credentials.sessionToken());
        }

        String host = uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
        TreeMap<String, String> normalized = new TreeMap<>();
        result.forEach((name, value) -> normalized.put(name.toLowerCase(), value.trim().replaceAll("\\s+", " ")));
        normalized.put("host", host);
        String signedHeaders = String.join(";", normalized.keySet());
        String canonicalHeaders = normalized.entrySet().stream()
                .map(e -> e.getKey() + ":" + e.getValue() + "\n")
                .collect(Collectors.joining());

        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        String canonical = String.join("\n", method, path, canonicalQuery(uri.getRawQuery()),
                canonicalHeaders, signedHeaders, hex(sha256(body.getBytes(StandardCharsets.UTF_8))));
        String scope = day + "/" + credentials.region() + "/" + service + "/aws4_request";
        String stringToSign = String.join("\n", "AWS4-HMAC-SHA256", amzDate, scope,
                hex(sha256(canonical.getBytes(StandardCharsets.UTF_8))));

        byte[] key = hmac(("AWS4" + credentials.secretAccessKey()).getBytes(StandardCharsets.UTF_8), day);
        key = hmac(key, credentials.region());
        key = hmac(key, service);
        key = hmac(key, "aws4_request");
        String signature = hex(hmac(key, stringToSign));

        result.put("Authorization", "AWS4-HMAC-SHA256 Credential=" + credentials.accessKeyId() + "/" + scope
                + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature);
        return result;
    }

    /** Consulta canónica: cada par codificado según RFC 3986 y ordenado. */
    private static String canonicalQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            return "";
        }
        List<String[]> pairs = new ArrayList<>();
        for (String pair : rawQuery.split("&")) {
            String[] parts = pair.split("=", 2);
            pairs.add(new String[]{encode(parts[0]), encode(parts.length > 1 ? parts[1] : "")});
        }
        pairs.sort((a, b) -> a[0].equals(b[0]) ? a[1].compareTo(b[1]) : a[0].compareTo(b[0]));
        return pairs.stream().map(p -> p[0] + "=" + p[1]).collect(Collectors.joining("&"));
    }

    private static String encode(String value) {
        String decoded = URLDecoder.decode(value, StandardCharsets.UTF_8);
        return URLEncoder.encode(decoded, StandardCharsets.UTF_8)
                .replace("+", "%20").replace("*", "%2A").replace("%7E", "~");
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hex(byte[] data) {
        return HexFormat.of().formatHex(data);
    }
}
