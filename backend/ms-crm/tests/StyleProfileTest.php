<?php

namespace Tests;

use App\Core\Entities\Client;
use App\Core\UseCases\UpdateStyleProfileUseCase;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/Fakes.php';

class StyleProfileTest extends TestCase
{
    private FakeClients $clients;
    private UpdateStyleProfileUseCase $useCase;
    private Client $account;

    protected function setUp(): void
    {
        $this->clients = new FakeClients();
        $this->useCase = new UpdateStyleProfileUseCase($this->clients);
        $this->account = new Client('cli-9', 'Ana', 'ana@example.com', '');
    }

    public function testGuardaLasRespuestasYCreaLaFichaSiNoExiste(): void
    {
        $client = $this->useCase->execute($this->account, ['gender' => 'FEMALE', 'ageRange' => '30_44', 'vibe' => 'NATURAL']);

        $this->assertSame('FEMALE', $client->getStyleProfile()->gender);
        $this->assertSame('30_44', $client->getStyleProfile()->ageRange);
        $this->assertSame('NATURAL', $client->getStyleProfile()->vibe);
        $this->assertNull($client->getStyleProfile()->maintenance);
    }

    public function testOmitirTambienQuedaRegistrado(): void
    {
        $client = $this->useCase->execute($this->account, []);

        $this->assertNull($client->getStyleProfile()->gender);
        $this->assertNotNull($client->getStyleProfile()->onboardedAt);
    }

    public function testNoCambiaLosPuntosDeUnClienteExistente(): void
    {
        $this->clients->save(new Client('cli-9', 'Ana', 'ana@example.com', '700', 500));

        $client = $this->useCase->execute($this->account, ['gender' => 'MALE']);

        $this->assertSame(500, $client->getLoyaltyPoints());
        $this->assertSame('700', $client->getPhone());
    }

    /** @dataProvider valoresInvalidos */
    public function testRechazaValoresDesconocidos(array $answers): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->useCase->execute($this->account, $answers);
    }

    public static function valoresInvalidos(): array
    {
        return [
            'género' => [['gender' => 'X']],
            'edad' => [['ageRange' => '20']],
            'largo' => [['preferredLength' => 'XL']],
            'mantenimiento' => [['maintenance' => 'NUNCA']],
            'estilo' => [['vibe' => 'PUNK']],
        ];
    }
}
