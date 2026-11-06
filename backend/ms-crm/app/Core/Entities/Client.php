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
    private StyleProfile $styleProfile;
    private bool $whatsappOptIn;

    public function __construct(
        string $id,
        string $fullName,
        string $email,
        string $phone,
        int $loyaltyPoints = 0,
        ?string $createdAt = null,
        ?StyleProfile $styleProfile = null,
        bool $whatsappOptIn = false
    ) {
        $this->id = $id;
        $this->fullName = $fullName;
        $this->email = $email;
        $this->phone = $phone;
        $this->loyaltyPoints = $loyaltyPoints;
        $this->createdAt = $createdAt ?? date('Y-m-d H:i:s');
        $this->styleProfile = $styleProfile ?? new StyleProfile();
        $this->whatsappOptIn = $whatsappOptIn;
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

    public function acceptsWhatsapp(): bool
    {
        return $this->whatsappOptIn;
    }

    public function getStyleProfile(): StyleProfile
    {
        return $this->styleProfile;
    }

    public function getCreatedAt(): string
    {
        return $this->createdAt;
    }
}
