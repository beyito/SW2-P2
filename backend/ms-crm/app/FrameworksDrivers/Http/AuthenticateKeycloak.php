<?php

namespace App\FrameworksDrivers\Http;

use App\InterfaceAdapters\Security\AuthException;
use App\InterfaceAdapters\Security\Authenticator;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Exige un token válido de Keycloak y, si se indican, alguno de los roles requeridos (RF-01).
 */
class AuthenticateKeycloak
{
    public function __construct(private Authenticator $authenticator)
    {
    }

    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        try {
            $claims = $this->authenticator->authenticate((string) $request->header('Authorization'), $roles);
        } catch (AuthException $error) {
            $headers = $error->status === 401 ? ['WWW-Authenticate' => 'Bearer'] : [];
            return response()->json(['code' => $error->errorCode, 'message' => $error->getMessage()], $error->status, $headers);
        }

        $request->attributes->set('claims', $claims);

        return $next($request);
    }
}
