<?php

namespace App\Core\Entities;

/**
 * Entidad Pura de Negocio: Cliente del Salón (Clean Architecture)
 */
class Client
{
    private string $id;
    private string $fullName;
    private string $email;
    private string $phone;
    private int $loyaltyPoints;
    private string $createdAt;

    public function __construct(
        string $id,
        string $fullName,
        string $email,
        string $phone,
        int $loyaltyPoints = 0,
        ?string $createdAt = null
    ) {
        $this->id = $id;
        $this->fullName = $fullName;
        $this->email = $email;
        $this->phone = $phone;
        $this->loyaltyPoints = $loyaltyPoints;
        $this->createdAt = $createdAt ?? date('Y-m-d H:i:s');
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getFullName(): string
    {
        return $this->fullName;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function getPhone(): string
    {
        return $this->phone;
    }

    public function getLoyaltyPoints(): int
    {
        return $this->loyaltyPoints;
    }

    public function getCreatedAt(): string
    {
        return $this->createdAt;
    }

    public function addPoints(int $points): void
    {
        if ($points <= 0) {
            throw new \InvalidArgumentException('Los puntos a sumar deben ser mayores a cero.');
        }
        $this->loyaltyPoints += $points;
    }

    public function redeemPoints(int $points): void
    {
        if ($points <= 0) {
            throw new \InvalidArgumentException('Los puntos a canjear deben ser mayores a cero.');
        }
        if ($this->loyaltyPoints < $points) {
            throw new \IllegalStateException('Puntos insuficientes para realizar el canje.');
        }
        $this->loyaltyPoints -= $points;
    }
}
