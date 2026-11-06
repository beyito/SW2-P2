<?php

use App\FrameworksDrivers\Http\AuthenticateKeycloak;
use Nuwave\Lighthouse\Http\Middleware\AcceptJson;

return [
    // Todo el endpoint GraphQL exige un token válido de Keycloak
    'route' => [
        'uri' => '/graphql',
        'name' => 'graphql',
        'middleware' => [AcceptJson::class, AuthenticateKeycloak::class],
    ],
    'schema_path' => base_path('graphql/schema.graphql'),
];
