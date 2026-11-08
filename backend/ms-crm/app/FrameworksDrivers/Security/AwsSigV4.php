<?php

namespace App\FrameworksDrivers\Security;

/**
 * Firma de peticiones a AWS con Signature Version 4.
 * DynamoDB real la exige; DynamoDB Local acepta cualquier firma, así que el mismo código sirve en ambos.
 */
final class AwsSigV4
{
    /**
     * Credenciales del entorno. Sin ellas se usan unas de relleno, válidas solo para DynamoDB Local.
     */
    public static function credentialsFromEnv(?array $env = null): array
    {
        $read = fn (string $name) => $env === null ? (getenv($name) ?: '') : ($env[$name] ?? '');
        return [
            'accessKeyId' => $read('AWS_ACCESS_KEY_ID') ?: 'local',
            'secretAccessKey' => $read('AWS_SECRET_ACCESS_KEY') ?: 'local',
            'sessionToken' => $read('AWS_SESSION_TOKEN') ?: null,
            'region' => $read('AWS_REGION') ?: ($read('AWS_DEFAULT_REGION') ?: 'us-east-1'),
        ];
    }

    /**
     * Devuelve las cabeceras firmadas. Las cabeceras recibidas deben ser todas las que se enviarán.
     *
     * @param array<string,string> $headers
     * @return array<string,string>
     */
    public static function sign(
        string $method,
        string $url,
        array $headers,
        string $body,
        string $service,
        array $credentials,
        ?\DateTimeImmutable $now = null,
    ): array {
        $parts = parse_url($url);
        $host = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $amzDate = ($now ?? new \DateTimeImmutable())->setTimezone(new \DateTimeZone('UTC'))->format('Ymd\THis\Z');
        $day = substr($amzDate, 0, 8);

        $extra = ['X-Amz-Date' => $amzDate];
        if (!empty($credentials['sessionToken'])) {
            $extra['X-Amz-Security-Token'] = $credentials['sessionToken'];
        }

        $normalized = [];
        foreach ($headers + $extra + ['Host' => $host] as $name => $value) {
            $normalized[strtolower($name)] = preg_replace('/\s+/', ' ', trim((string) $value));
        }
        ksort($normalized, SORT_STRING);
        $signedHeaders = implode(';', array_keys($normalized));
        $canonicalHeaders = '';
        foreach ($normalized as $name => $value) {
            $canonicalHeaders .= $name . ':' . $value . "\n";
        }

        // Consulta canónica: cada par codificado según RFC 3986 y ordenado
        $pairs = [];
        if (!empty($parts['query'])) {
            foreach (explode('&', $parts['query']) as $pair) {
                [$key, $value] = array_pad(explode('=', $pair, 2), 2, '');
                $pairs[] = [rawurlencode(urldecode($key)), rawurlencode(urldecode($value))];
            }
            usort($pairs, fn ($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        }
        $query = implode('&', array_map(fn ($p) => $p[0] . '=' . $p[1], $pairs));

        $canonical = implode("\n", [
            $method,
            ($parts['path'] ?? '') === '' ? '/' : $parts['path'],
            $query,
            $canonicalHeaders,
            $signedHeaders,
            hash('sha256', $body),
        ]);
        $scope = "{$day}/{$credentials['region']}/{$service}/aws4_request";
        $stringToSign = implode("\n", ['AWS4-HMAC-SHA256', $amzDate, $scope, hash('sha256', $canonical)]);

        $key = hash_hmac('sha256', $day, 'AWS4' . $credentials['secretAccessKey'], true);
        $key = hash_hmac('sha256', $credentials['region'], $key, true);
        $key = hash_hmac('sha256', $service, $key, true);
        $key = hash_hmac('sha256', 'aws4_request', $key, true);
        $signature = hash_hmac('sha256', $stringToSign, $key);

        return $headers + $extra + [
            'Authorization' => "AWS4-HMAC-SHA256 Credential={$credentials['accessKeyId']}/{$scope}, "
                . "SignedHeaders={$signedHeaders}, Signature={$signature}",
        ];
    }
}
