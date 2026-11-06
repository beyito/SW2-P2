<?php

namespace App\FrameworksDrivers\Providers;

use App\FrameworksDrivers\Persistence\PostgresClientRepository;
use App\FrameworksDrivers\Persistence\PostgresInvoiceRepository;
use App\FrameworksDrivers\Persistence\PostgresLoyaltyLedger;
use App\FrameworksDrivers\Security\CachedJwksProvider;
use App\FrameworksDrivers\Security\DynamoSessionRegistry;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;
use App\InterfaceAdapters\Security\Authenticator;
use App\InterfaceAdapters\Security\JwtVerifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

/**
 * Conecta los puertos de Clean Architecture con sus adaptadores de PostgreSQL y Keycloak.
 */
class CrmServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $pdo = fn () => DB::connection()->getPdo();

        $this->app->singleton(ClientRepositoryInterface::class, fn () => new PostgresClientRepository($pdo()));
        $this->app->singleton(InvoiceRepositoryInterface::class, fn () => new PostgresInvoiceRepository($pdo()));
        $this->app->singleton(LoyaltyLedgerInterface::class, fn () => new PostgresLoyaltyLedger($pdo()));

        $this->app->singleton(Authenticator::class, function () {
            $issuer = env('KEYCLOAK_ISSUER', 'http://localhost:8080/realms/salon');
            return new Authenticator(
                new JwtVerifier(
                    $issuer,
                    env('KEYCLOAK_AUDIENCE', 'salon-api'),
                    new CachedJwksProvider(env('KEYCLOAK_JWKS_URI', "{$issuer}/protocol/openid-connect/certs"))
                ),
                new DynamoSessionRegistry(env('DYNAMODB_ENDPOINT', 'http://localhost:8000'))
            );
        });
    }
}
