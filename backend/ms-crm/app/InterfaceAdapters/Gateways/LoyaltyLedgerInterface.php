<?php

namespace App\InterfaceAdapters\Gateways;

/**
 * Libro de puntos de fidelidad. Cada movimiento es atómico e idempotente por su referencia.
 */
interface LoyaltyLedgerInterface
{
    /** Suma puntos; si la referencia ya se aplicó no hace nada. */
    public function credit(string $clientId, int $points, string $type, string $description, string $sourceRef): void;

    /**
     * Descuenta puntos solo si alcanza el saldo.
     *
     * @return bool false si el saldo no alcanza. Si la referencia ya se aplicó devuelve true.
     */
    public function debit(string $clientId, int $points, string $type, string $description, string $sourceRef): bool;

    /** Descuenta hasta donde alcance el saldo, sin dejarlo negativo. */
    public function debitUpToBalance(string $clientId, int $points, string $type, string $description, string $sourceRef): void;

    /** Puntos absolutos del movimiento con esa referencia, o null si no existe. */
    public function pointsOf(string $sourceRef): ?int;

    public function balanceOf(string $clientId): int;

    /** @return array<int, array{id: string, points: int, type: string, description: string, createdAt: string}> */
    public function historyOf(string $clientId): array;
}
