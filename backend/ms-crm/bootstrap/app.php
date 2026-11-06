<?php

use App\FrameworksDrivers\Console\ConsumeSagaMessages;
use App\FrameworksDrivers\Http\AuthenticateKeycloak;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(api: __DIR__ . '/../routes/api.php', apiPrefix: '')
    ->withCommands([ConsumeSagaMessages::class])
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias(['keycloak' => AuthenticateKeycloak::class]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Es una API: los errores siempre se responden en JSON
        $exceptions->shouldRenderJsonWhen(fn () => true);
    })
    ->create();
