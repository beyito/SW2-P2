<?php

namespace Tests;

use PHPUnit\Framework\TestCase;
use App\Core\UseCases\RegisterClientUseCase;
use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

class RegisterClientUseCaseTest extends TestCase
{
    public function testRegisterNewClientSuccessfully(): void
    {
        $mockRepo = $this->createMock(ClientRepositoryInterface::class);
        $mockRepo->expects($this->once())
            ->method('existsEmail')
            ->with('valeria@example.com')
            ->willReturn(false);

        $mockRepo->expects($this->once())
            ->method('save')
            ->willReturnCallback(function (Client $client) {
                return $client;
            });

        $useCase = new RegisterClientUseCase($mockRepo);
        $client = $useCase->execute('Valeria Gomez', 'valeria@example.com', '+591 70012345');

        $this->assertInstanceOf(Client::class, $client);
        $this->assertEquals('Valeria Gomez', $client->getFullName());
        $this->assertEquals('valeria@example.com', $client->getEmail());
        $this->assertEquals(0, $client->getLoyaltyPoints());
        $this->assertStringStartsWith('cli_', $client->getId());
    }

    public function testRegisterClientWithDuplicateEmailThrowsException(): void
    {
        $mockRepo = $this->createMock(ClientRepositoryInterface::class);
        $mockRepo->expects($this->once())
            ->method('existsEmail')
            ->with('duplicado@example.com')
            ->willReturn(true);

        $useCase = new RegisterClientUseCase($mockRepo);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage("El correo 'duplicado@example.com' ya se encuentra registrado en el CRM.");

        $useCase->execute('Cliente Duplicado', 'duplicado@example.com', '+591 70000000');
    }
}
