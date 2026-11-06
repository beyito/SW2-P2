<?php

use App\FrameworksDrivers\Persistence\PostgresClientRepository;
use App\FrameworksDrivers\Security\CachedJwksProvider;
use App\FrameworksDrivers\Security\DynamoSessionRegistry;
use App\InterfaceAdapters\Security\AuthException;
use App\InterfaceAdapters\Security\Authenticator;
use App\InterfaceAdapters\Security\JwtVerifier;

// Carga automática de clases según PSR-4 (App\ => app/)
spl_autoload_register(function (string $class): void {
    if (str_starts_with($class, 'App\\')) {
        $file = __DIR__ . '/app/' . str_replace('\\', '/', substr($class, 4)) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});

header('Content-Type: application/json');

// Solo los microfrontends de la plataforma pueden invocar la API desde el navegador
$allowedOrigins = explode(',', getenv('ALLOWED_ORIGINS') ?: 'http://localhost:3000');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($uri === '/' || $uri === '/health') {
    echo json_encode([
        'service' => 'ms-crm',
        'status' => 'UP',
        'framework' => 'PHP 8.3 / Clean Architecture',
        'database' => 'PostgreSQL (salon_crm)',
        'timestamp' => date('c')
    ]);
    exit;
}

$authenticator = new Authenticator(
    new JwtVerifier(
        getenv('KEYCLOAK_ISSUER') ?: 'http://localhost:8080/realms/salon',
        getenv('KEYCLOAK_AUDIENCE') ?: 'salon-api',
        new CachedJwksProvider(
            getenv('KEYCLOAK_JWKS_URI') ?: 'http://localhost:8080/realms/salon/protocol/openid-connect/certs'
        )
    ),
    new DynamoSessionRegistry(getenv('DYNAMODB_ENDPOINT') ?: 'http://localhost:8000')
);

try {
    if ($uri === '/api/clients') {
        // Datos personales de clientes: solo para el personal del salón
        $authenticator->authenticate($_SERVER['HTTP_AUTHORIZATION'] ?? '', ['ADMIN', 'STYLIST']);

        $clients = (new PostgresClientRepository())->findAll();
        echo json_encode(array_map(fn ($c) => [
            'id' => $c->getId(),
            'fullName' => $c->getFullName(),
            'email' => $c->getEmail(),
            'loyaltyPoints' => $c->getLoyaltyPoints()
        ], $clients));
        exit;
    }

    http_response_code(404);
    echo json_encode(['error' => 'Not Found']);
} catch (AuthException $e) {
    http_response_code($e->status);
    if ($e->status === 401) {
        header('WWW-Authenticate: Bearer');
    }
    echo json_encode(['code' => $e->errorCode, 'message' => $e->getMessage()]);
} catch (\Exception $e) {
    // No se expone el detalle interno al cliente
    error_log($e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Error interno del servidor']);
}
