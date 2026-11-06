<?php

namespace App\Core\Entities;

/**
 * Objeto de Valor: preferencias que el cliente declara para orientar sus recomendaciones.
 * Todos los datos son opcionales. Ninguno se comparte con el personal ni con servicios externos.
 */
final class StyleProfile
{
    public const GENDERS = ['FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED'];
    public const AGE_RANGES = ['UNDER_18', '18_29', '30_44', '45_59', '60_PLUS'];
    public const LENGTHS = ['SHORT', 'MEDIUM', 'LONG'];
    public const MAINTENANCE = ['LOW', 'MEDIUM', 'HIGH'];
    public const VIBES = ['NATURAL', 'PROFESSIONAL', 'TRENDY', 'BOLD'];

    public function __construct(
        public readonly ?string $gender = null,
        public readonly ?string $ageRange = null,
        public readonly ?string $preferredLength = null,
        public readonly ?string $maintenance = null,
        public readonly ?string $vibe = null,
        public readonly ?string $onboardedAt = null
    ) {
        self::assertIn($gender, self::GENDERS, 'género');
        self::assertIn($ageRange, self::AGE_RANGES, 'rango de edad');
        self::assertIn($preferredLength, self::LENGTHS, 'largo');
        self::assertIn($maintenance, self::MAINTENANCE, 'mantenimiento');
        self::assertIn($vibe, self::VIBES, 'estilo');
    }

    private static function assertIn(?string $value, array $allowed, string $field): void
    {
        if ($value !== null && !in_array($value, $allowed, true)) {
            throw new \InvalidArgumentException("El valor de {$field} no es válido.");
        }
    }
}
