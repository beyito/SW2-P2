<?php

namespace App\FrameworksDrivers\Push;

use App\InterfaceAdapters\Gateways\PushSenderInterface;
use RuntimeException;

/**
 * Notificaciones push con la API HTTP v1 de Firebase Cloud Messaging, sin SDK.
 * Se autentica con la clave de una cuenta de servicio de Google: firma un JWT con RS256 y lo cambia
 * por un token de acceso de OAuth 2.0, que reutiliza mientras no venza.
 */
class FcmPushSender implements PushSenderInterface
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private ?string $accessToken = null;
    private int $expiresAt = 0;

    /**
     * @param array{project_id: string, client_email: string, private_key: string} $account Clave JSON de la cuenta.
     * @param callable(string $method, string $url, array $headers, string $body): array{0: int, 1: string} $http
     */
    public function __construct(private array $account, private $http = null)
    {
        $this->http ??= [self::class, 'request'];
    }

    /** Lee la cuenta de FCM_CREDENTIALS_JSON (el JSON o su base64); sin ella no hay push. */
    public static function fromEnv(): ?self
    {
        $raw = (string) env('FCM_CREDENTIALS_JSON', '');
        if ($raw === '') {
            return null;
        }
        $json = str_starts_with(ltrim($raw), '{') ? $raw : base64_decode($raw, true);
        $account = json_decode((string) $json, true);
        if (!isset($account['project_id'], $account['client_email'], $account['private_key'])) {
            throw new RuntimeException('FCM_CREDENTIALS_JSON no es la clave de una cuenta de servicio.');
        }
        return new self($account);
    }

    public function send(string $token, string $title, string $body, array $data = []): string
    {
        $message = [
            'message' => [
                'token' => $token,
                'notification' => ['title' => $title, 'body' => $body],
                'data' => array_map('strval', $data),
                // Canal de importancia alta que crea la app: Android muestra el push flotando arriba
                'android' => ['priority' => 'HIGH', 'notification' => ['channel_id' => 'avisos']],
            ],
        ];
        [$status, $response] = ($this->http)('POST', "https://fcm.googleapis.com/v1/projects/{$this->account['project_id']}/messages:send", [
            'Authorization: Bearer ' . $this->accessToken(),
            'Content-Type: application/json',
        ], json_encode($message));

        if ($status === 200) {
            return self::SENT;
        }
        $error = json_decode($response, true)['error'] ?? [];
        $code = $error['details'][0]['errorCode'] ?? $error['status'] ?? '';
        // El token ya no corresponde a una instalación de la app
        if ($status === 404 || in_array($code, ['UNREGISTERED', 'INVALID_ARGUMENT'], true)) {
            return self::INVALID_TOKEN;
        }
        error_log("[CRM] FCM respondió {$status}: " . substr($response, 0, 200));
        return self::FAILED;
    }

    /** JWT firmado con la clave de la cuenta (RFC 7523), para pedir el token de acceso. */
    public function assertion(int $now): string
    {
        $encode = fn (array $part) => rtrim(strtr(base64_encode(json_encode($part)), '+/', '-_'), '=');
        $unsigned = $encode(['alg' => 'RS256', 'typ' => 'JWT']) . '.' . $encode([
            'iss' => $this->account['client_email'],
            'scope' => self::SCOPE,
            'aud' => self::TOKEN_URL,
            'iat' => $now,
            'exp' => $now + 3600,
        ]);
        if (!openssl_sign($unsigned, $signature, $this->account['private_key'], OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('No se pudo firmar con la clave de la cuenta de servicio.');
        }
        return $unsigned . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
    }

    private function accessToken(): string
    {
        $now = time();
        if ($this->accessToken !== null && $now < $this->expiresAt - 60) {
            return $this->accessToken;
        }
        [$status, $response] = ($this->http)('POST', self::TOKEN_URL, ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $this->assertion($now),
        ]));
        $body = json_decode($response, true);
        if ($status !== 200 || empty($body['access_token'])) {
            throw new RuntimeException("Google no entregó el token de acceso ({$status}).");
        }
        $this->accessToken = $body['access_token'];
        $this->expiresAt = $now + (int) ($body['expires_in'] ?? 3600);
        return $this->accessToken;
    }

    /** @return array{0: int, 1: string} */
    private static function request(string $method, string $url, array $headers, string $body): array
    {
        $context = stream_context_create(['http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => 5,
            'ignore_errors' => true,
        ]]);
        $response = @file_get_contents($url, false, $context);
        $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m) ? (int) $m[1] : 0;
        return [$status, $response === false ? '' : $response];
    }
}
