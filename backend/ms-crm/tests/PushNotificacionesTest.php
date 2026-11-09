<?php

namespace Tests;

use App\Core\Entities\Notice;
use App\Core\UseCases\RecordNoticesUseCase;
use App\FrameworksDrivers\Push\FcmPushSender;
use App\InterfaceAdapters\Gateways\PushDeviceRepositoryInterface;
use App\InterfaceAdapters\Gateways\PushSenderInterface;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once __DIR__ . '/Fakes.php';

/** Teléfonos en memoria. */
class FakePushDevices implements PushDeviceRepositoryInterface
{
    /** @var array<string, array{user: string, admin: bool}> */
    public array $devices = [];

    public function register(string $token, string $userId, bool $isAdmin): void
    {
        $this->devices[$token] = ['user' => $userId, 'admin' => $isAdmin];
    }

    public function remove(string $token): void
    {
        unset($this->devices[$token]);
    }

    public function tokensFor(string $recipient): array
    {
        return array_keys(array_filter($this->devices, fn ($d) => $recipient === Notice::ADMINS ? $d['admin'] : $d['user'] === $recipient));
    }
}

/** Envío simulado: guarda cada push y responde lo que se le indique por token. */
class FakePushSender implements PushSenderInterface
{
    public array $sent = [];
    public array $answers = [];
    public bool $explode = false;

    public function send(string $token, string $title, string $body, array $data = []): string
    {
        if ($this->explode) {
            throw new RuntimeException('FCM no responde');
        }
        $this->sent[] = compact('token', 'title', 'body', 'data');
        return $this->answers[$token] ?? self::SENT;
    }
}

class PushNotificacionesTest extends TestCase
{
    private FakeNotices $notices;
    private FakePushDevices $devices;
    private FakePushSender $push;
    private RecordNoticesUseCase $useCase;

    protected function setUp(): void
    {
        $this->devices = new FakePushDevices();
        $this->push = new FakePushSender();
        $this->useCase = new RecordNoticesUseCase($this->notices = new FakeNotices(), $this->devices, $this->push);
        $this->devices->register(str_repeat('a', 120), 'cli-001', false);
        $this->devices->register(str_repeat('b', 120), 'cli-001', false);
        $this->devices->register(str_repeat('c', 120), 'adm-001', true);
    }

    public function test_un_aviso_nuevo_llega_a_todos_los_telefonos_del_cliente(): void
    {
        $this->useCase->paymentConfirmed('saga-1', 'cli-001', 'Balayage');

        $this->assertCount(2, $this->push->sent);
        $this->assertSame('Pago confirmado', $this->push->sent[0]['title']);
        $this->assertStringContainsString('Balayage', $this->push->sent[0]['body']);
        $this->assertSame('PAYMENT', $this->push->sent[0]['data']['type']);
    }

    public function test_un_evento_repetido_no_manda_el_push_otra_vez(): void
    {
        $this->useCase->paymentConfirmed('saga-1', 'cli-001', 'Balayage');
        $this->useCase->paymentConfirmed('saga-1', 'cli-001', 'Balayage');
        $this->assertCount(2, $this->push->sent);
    }

    public function test_los_avisos_de_la_administracion_van_a_sus_telefonos(): void
    {
        $this->useCase->stockCritical(['KER-1L'], '2026-11-09');
        $this->assertSame([str_repeat('c', 120)], array_column($this->push->sent, 'token'));
    }

    public function test_un_token_invalido_se_olvida(): void
    {
        $this->push->answers[str_repeat('a', 120)] = PushSenderInterface::INVALID_TOKEN;
        $this->useCase->refundApplied('saga-2', 'cli-001', 45.0);
        $this->assertArrayNotHasKey(str_repeat('a', 120), $this->devices->devices);
        $this->assertArrayHasKey(str_repeat('b', 120), $this->devices->devices);
    }

    public function test_si_el_push_falla_el_aviso_igual_queda_guardado(): void
    {
        $this->push->explode = true;
        $this->assertTrue($this->useCase->automation('cli-001', 'Recordatorio', 'Tu cita es mañana', 'rec-1'));
        $this->assertCount(1, $this->notices->items);
    }

    public function test_sin_push_configurado_solo_se_guarda_el_aviso(): void
    {
        $sinPush = new RecordNoticesUseCase($notices = new FakeNotices());
        $sinPush->paymentConfirmed('saga-3', 'cli-001', 'Corte');
        $this->assertCount(1, $notices->items);
    }

    public function test_fcm_firma_el_jwt_con_la_clave_de_la_cuenta(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($key, $pem);
        $sender = new FcmPushSender(['project_id' => 'p', 'client_email' => 'salon-fcm@p.iam.gserviceaccount.com', 'private_key' => $pem]);

        [$header, $payload, $signature] = explode('.', $sender->assertion(1_700_000_000));
        $decode = fn (string $part) => base64_decode(strtr($part, '-_', '+/'));
        $claims = json_decode($decode($payload), true);
        $this->assertSame('RS256', json_decode($decode($header), true)['alg']);
        $this->assertSame('salon-fcm@p.iam.gserviceaccount.com', $claims['iss']);
        $this->assertSame('https://www.googleapis.com/auth/firebase.messaging', $claims['scope']);
        $this->assertSame(1_700_003_600, $claims['exp']);
        $publica = openssl_pkey_get_details($key)['key'];
        $this->assertSame(1, openssl_verify("{$header}.{$payload}", $decode($signature), $publica, OPENSSL_ALGO_SHA256));
    }

    public function test_fcm_pide_el_token_una_vez_y_arma_el_mensaje(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($key, $pem);
        $calls = [];
        $http = function (string $method, string $url, array $headers, string $body) use (&$calls) {
            $calls[] = compact('url', 'headers', 'body');
            if (str_contains($url, 'oauth2')) {
                return [200, json_encode(['access_token' => 'ya29.prueba', 'expires_in' => 3600])];
            }
            return str_contains($body, 'token-viejo') ? [404, '{"error":{"status":"NOT_FOUND"}}'] : [200, '{"name":"projects/p/messages/1"}'];
        };
        $sender = new FcmPushSender(['project_id' => 'salon-p', 'client_email' => 'x@y', 'private_key' => $pem], $http);

        $this->assertSame(PushSenderInterface::SENT, $sender->send('token-nuevo', 'Pago confirmado', 'Listo', ['type' => 'PAYMENT']));
        $this->assertSame(PushSenderInterface::INVALID_TOKEN, $sender->send('token-viejo', 'T', 'B'));

        $this->assertCount(3, $calls);  // un solo token de acceso para los dos envíos
        $this->assertSame('https://fcm.googleapis.com/v1/projects/salon-p/messages:send', $calls[1]['url']);
        $this->assertContains('Authorization: Bearer ya29.prueba', $calls[1]['headers']);
        $mensaje = json_decode($calls[1]['body'], true)['message'];
        $this->assertSame('token-nuevo', $mensaje['token']);
        $this->assertSame(['title' => 'Pago confirmado', 'body' => 'Listo'], $mensaje['notification']);
        $this->assertSame('HIGH', $mensaje['android']['priority']);
        $this->assertSame('avisos', $mensaje['android']['notification']['channel_id']);
    }
}
