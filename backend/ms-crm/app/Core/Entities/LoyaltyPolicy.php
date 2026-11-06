<?php

namespace App\Core\Entities;

/**
 * Reglas de fidelización (RF-08): se ganan 10 puntos por dólar pagado y cada punto vale un centavo.
 */
final class LoyaltyPolicy
{
    /** Cobro mínimo que acepta la pasarela: el canje no puede dejar un monto menor. */
    public const MINIMUM_CHARGE_CENTS = 50;

    public static function pointsEarnedFor(int $paidCents): int
    {
        return (int) floor($paidCents / 10);
    }

    public static function discountCentsFor(int $points): int
    {
        return $points;
    }

    public static function canRedeem(int $points, int $amountCents): bool
    {
        return $points > 0 && $amountCents - self::discountCentsFor($points) >= self::MINIMUM_CHARGE_CENTS;
    }
}
