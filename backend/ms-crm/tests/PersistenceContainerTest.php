<?php

namespace Tests;

use App\Core\Entities\Client;
use App\Core\Entities\Notice;
use App\Core\Entities\StyleProfile;
use App\FrameworksDrivers\Persistence\PostgresClientRepository;
use App\FrameworksDrivers\Persistence\PostgresLoyaltyLedger;
use App\FrameworksDrivers\Persistence\PostgresNoticeRepository;
use PDO;
use PHPUnit\Framework\TestCase;
use Testcontainers\Container\StartedGenericContainer;
use Testcontainers\Modules\PostgresContainer;

/**
 * Repositorios sobre un PostgreSQL real en un contenedor propio, con las migraciones reales.
 * Requiere el socket de Docker y las migraciones montadas: ver MANUAL_EJECUCION.md.
 */
class PersistenceContainerTest extends TestCase
{
    private const MIGRATIONS_DIR = '/migrations';
    private const CRM_MIGRATIONS = ['02_crm_schema.sql', '04_crm_facturacion.sql', '07_avisos_crm.sql', '08_perfil_de_estilo.sql', '12_push_crm.sql'];

    private static ?StartedGenericContainer $container = null;
    private static PDO $pdo;

    public static function setUpBeforeClass(): void
    {
        if (!file_exists('/var/run/docker.sock') || !is_dir(self::MIGRATIONS_DIR)) {
            return;
        }
        self::$container = (new PostgresContainer('16-alpine'))
            ->withPostgresDatabase('crm')
            ->withPostgresUser('prueba')
            ->withPostgresPassword('prueba')
            ->start();
        $host = getenv('TESTCONTAINERS_HOST_OVERRIDE') ?: self::$container->getHost();
        self::$pdo = new PDO(
            sprintf('pgsql:host=%s;port=%d;dbname=crm', $host, self::$container->getFirstMappedPort()),
            'prueba',
            'prueba',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        foreach (self::CRM_MIGRATIONS as $script) {
            self::$pdo->exec(file_get_contents(self::MIGRATIONS_DIR . '/' . $script));
        }
    }

    public static function tearDownAfterClass(): void
    {
        self::$container?->stop();
    }

    protected function setUp(): void
    {
        if (self::$container === null) {
            $this->markTestSkipped('Requiere el socket de Docker y las migraciones montadas.');
        }
    }

    private function nuevoCliente(int $puntos = 0): Client
    {
        $id = 'tc-' . bin2hex(random_bytes(6));
        $client = new Client($id, 'Ana', "{$id}@example.com", '700', $puntos);
        (new PostgresClientRepository(self::$pdo))->save($client);
        return $client;
    }

    public function testLasMigracionesSonIdempotentes(): void
    {
        foreach (self::CRM_MIGRATIONS as $script) {
            self::$pdo->exec(file_get_contents(self::MIGRATIONS_DIR . '/' . $script));
        }
        $this->assertGreaterThanOrEqual(0, (int) self::$pdo->query('SELECT count(*) FROM crm_clients')->fetchColumn());
    }

    public function testElPerfilDeEstiloSeGuardaYSeLeeCompleto(): void
    {
        $repository = new PostgresClientRepository(self::$pdo);
        $client = $this->nuevoCliente();
        $repository->updateStyleProfile($client->getId(), new StyleProfile('MALE', '30_44', 'SHORT', 'LOW', 'NATURAL', '2026-11-06 10:00:00'));

        $profile = $repository->findById($client->getId())->getStyleProfile();

        $this->assertSame('MALE', $profile->gender);
        $this->assertSame('30_44', $profile->ageRange);
        $this->assertSame('SHORT', $profile->preferredLength);
        $this->assertSame('LOW', $profile->maintenance);
        $this->assertSame('NATURAL', $profile->vibe);
        $this->assertNotNull($profile->onboardedAt);
    }

    public function testLaBaseRechazaUnGeneroDesconocido(): void
    {
        $client = $this->nuevoCliente();
        $this->expectException(\PDOException::class);
        self::$pdo->exec("UPDATE crm_clients SET gender = 'OTRO' WHERE id = '{$client->getId()}'");
    }

    public function testLaAutorizacionDeWhatsappEmpiezaApagadaYSePuedeCambiar(): void
    {
        $repository = new PostgresClientRepository(self::$pdo);
        $client = $this->nuevoCliente();
        $this->assertFalse($repository->findById($client->getId())->acceptsWhatsapp());
        $repository->updateWhatsappOptIn($client->getId(), true);
        $this->assertTrue($repository->findById($client->getId())->acceptsWhatsapp());
        $repository->updateWhatsappOptIn($client->getId(), false);
        $this->assertFalse($repository->findById($client->getId())->acceptsWhatsapp());
    }

    public function testCrearSiNoExisteNoPisaLosDatos(): void
    {
        $repository = new PostgresClientRepository(self::$pdo);
        $client = $this->nuevoCliente(500);
        $repository->createIfAbsent(new Client($client->getId(), 'Otro', 'otro@example.com', '111'));

        $saved = $repository->findById($client->getId());

        $this->assertSame('Ana', $saved->getFullName());
        $this->assertSame(500, $saved->getLoyaltyPoints());
    }

    public function testUnAvisoRepetidoNoSeDuplica(): void
    {
        $notices = new PostgresNoticeRepository(self::$pdo);
        $referencia = 'tc:' . bin2hex(random_bytes(6));
        $aviso = fn () => new Notice(id: 'ntc_' . bin2hex(random_bytes(8)), recipient: 'tc-destino', type: 'AUTOMATION', title: 'T', message: 'M', sourceRef: $referencia);

        $this->assertTrue($notices->addOnce($aviso()));
        $this->assertFalse($notices->addOnce($aviso()));
    }

    public function testNadieMarcaComoLeidoUnAvisoAjeno(): void
    {
        $notices = new PostgresNoticeRepository(self::$pdo);
        $id = 'ntc_' . bin2hex(random_bytes(8));
        $notices->addOnce(new Notice(id: $id, recipient: 'dueno', type: 'X', title: 'T', message: 'M', sourceRef: 'tc:' . $id));

        $this->assertFalse($notices->markRead($id, ['intruso']));
        $this->assertTrue($notices->markRead($id, ['dueno']));
    }

    public function testUnCreditoRepetidoSoloSumaUnaVez(): void
    {
        $ledger = new PostgresLoyaltyLedger(self::$pdo);
        $client = $this->nuevoCliente();
        $referencia = 'tc:' . bin2hex(random_bytes(6));

        $ledger->credit($client->getId(), 100, 'ACCUMULATION', 'Compra', $referencia);
        $ledger->credit($client->getId(), 100, 'ACCUMULATION', 'Compra', $referencia);

        $this->assertSame(100, $ledger->balanceOf($client->getId()));
    }

    public function testNoSePuedeGastarMasDeLoQueHay(): void
    {
        $ledger = new PostgresLoyaltyLedger(self::$pdo);
        $client = $this->nuevoCliente();
        $ledger->credit($client->getId(), 50, 'ACCUMULATION', 'Compra', 'tc:' . bin2hex(random_bytes(6)));

        $this->assertFalse($ledger->debit($client->getId(), 80, 'REDEMPTION', 'Canje', 'tc:' . bin2hex(random_bytes(6))));
        $this->assertSame(50, $ledger->balanceOf($client->getId()));
    }
}
