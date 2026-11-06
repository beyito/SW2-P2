<?php

namespace Tests;

use PHPUnit\Framework\TestCase;
use App\Core\UseCases\AccumulatePointsUseCase;
use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

class AccumulatePointsUseCaseTest extends TestCase
{
    public function testAccumulatePointsSuccessfully(): void
    {
        $client = new Client('cli_test_123', 'Camila Fernandez', 'camila@example.com', '+591 71234567', 50);

        $mockRepo = $this->createMock(ClientRepositoryInterface::class);
        $mockRepo->expects($this->once())
            ->method('findById')
            ->with('cli_test_123')
            ->willReturn($client);

        $mockRepo->expects($this->once())
            ->method('save')
            ->with($client)
            ->willReturn($client);

        $useCase = new AccumulatePointsUseCase($mockRepo);
        $newPoints = $useCase->execute('cli_test_123', 30);

        $this->assertEquals(80, $newPoints);
        $this->assertEquals(80, $client->getLoyaltyPoints());
    }

    public function testAccumulatePointsNonExistingClientThrowsException(): void
    {
        $mockRepo = $this->createMock(ClientRepositoryInterface::class);
        $mockRepo->expects($this->once())
            ->method('findById')
            ->with('cli_inexistente')
            ->willReturn(null);

        $useCase = new AccumulatePointsUseCase($mockRepo);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("Cliente no encontrado con ID: cli_inexistente");

        $useCase->execute('cli_inexistente', 10);
    }
}
