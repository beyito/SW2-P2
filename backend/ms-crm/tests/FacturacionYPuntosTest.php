<?php

namespace Tests;

use App\Core\Entities\Client;
use App\Core\Entities\LoyaltyPolicy;
use App\Core\UseCases\AccumulatePointsUseCase;
use App\Core\UseCases\ApplyRefundUseCase;
use App\Core\UseCases\ProcessCompletedBookingUseCase;
use App\Core\UseCases\RecordNoticesUseCase;
use App\Core\UseCases\ReleasePointsUseCase;
use App\Core\UseCases\ReservePointsUseCase;
use App\InterfaceAdapters\Messaging\SagaMessageHandler;
use PHPUnit\Framework\TestCase;

/**
 * Facturación, puntos, canje y reembolso (CU-07, CU-11, CU-12, RF-08).
 */
class FacturacionYPuntosTest extends TestCase
{
    private const EVENT = [
        'sagaId' => 's1',
        'appointmentId' => 'apt-1',
        'clientId' => 'cli-001',
        'clientName' => 'Camila Fernandez',
        'clientEmail' => 'camila@example.com',
        'serviceName' => 'Corte',
        'amountCents' => 4500,
        'discountCents' => 0,
        'paymentIntentId' => 'pi_1',
    ];

    private FakeClients $clients;
    private FakeInvoices $invoices;
    private FakeLedger $ledger;
    private FakeNotices $notices;
    private SagaMessageHandler $handler;

    protected function setUp(): void
    {
        $this->clients = new FakeClients();
        $this->invoices = new FakeInvoices();
        $this->ledger = new FakeLedger();
        $this->handler = new SagaMessageHandler(
            new ProcessCompletedBookingUseCase($this->clients, $this->invoices, $this->ledger),
            new ReservePointsUseCase($this->ledger),
            new ReleasePointsUseCase($this->ledger),
            new ApplyRefundUseCase($this->invoices, $this->ledger),
            new RecordNoticesUseCase($this->notices = new FakeNotices())
        );
    }

    private function reservePoints(int $points, int $amountCents = 4500): array
    {
        return $this->handler->handle('crm.command.points.reserve', [
            'sagaId' => 's1', 'clientId' => 'cli-001', 'points' => $points, 'amountCents' => $amountCents,
        ]);
    }

    public function testReglasDeFidelizacion(): void
    {
        $this->assertSame(450, LoyaltyPolicy::pointsEarnedFor(4500));
        $this->assertSame(0, LoyaltyPolicy::pointsEarnedFor(9));
        $this->assertTrue(LoyaltyPolicy::canRedeem(4450, 4500));
        $this->assertFalse(LoyaltyPolicy::canRedeem(4451, 4500));
        $this->assertFalse(LoyaltyPolicy::canRedeem(0, 4500));
    }

    public function testReservaPagadaGeneraFacturaConIvaIncluidoYPuntos(): void
    {
        $this->assertSame([], $this->handler->handle('saga.completed', self::EVENT));

        $invoice = $this->invoices->findBySagaId('s1');
        $this->assertSame(45.0, $invoice->getTotalAmount());
        $this->assertSame(5.85, $invoice->getTaxAmount());
        $this->assertSame('apt-1', $invoice->getAppointmentId());
        $this->assertSame('pi_1', $invoice->getPaymentReference());
        $this->assertSame(450, $this->ledger->balanceOf('cli-001'));
    }

    public function testLaReservaEnLineaSeFacturaComoTarjeta(): void
    {
        $this->handler->handle('saga.completed', self::EVENT);
        $this->assertSame('CARD', $this->invoices->findBySagaId('s1')->getPaymentMethod());
    }

    public function testElCobroEnMostradorSeFacturaConSuFormaDePagoYDaPuntos(): void
    {
        $this->handler->handle('saga.completed', [...self::EVENT, 'paymentMethod' => 'CASH', 'channel' => 'COUNTER']);

        $invoice = $this->invoices->findBySagaId('s1');
        $this->assertSame('CASH', $invoice->getPaymentMethod());
        $this->assertSame('Efectivo en el mostrador', \App\Core\Entities\Invoice::paymentMethodLabel($invoice->getPaymentMethod()));
        $this->assertSame(450, $this->ledger->balanceOf('cli-001'));
    }

    public function testUnaFormaDePagoDesconocidaNoSeGuardaTalCual(): void
    {
        $this->handler->handle('saga.completed', [...self::EVENT, 'paymentMethod' => 'BITCOIN']);
        $this->assertSame('CARD', $this->invoices->findBySagaId('s1')->getPaymentMethod());
    }

    public function testEventoRepetidoNoDuplicaFacturaNiPuntos(): void
    {
        $this->handler->handle('saga.completed', self::EVENT);
        $this->handler->handle('saga.completed', self::EVENT);

        $this->assertCount(1, $this->invoices->items);
        $this->assertSame(450, $this->ledger->balanceOf('cli-001'));
    }

    public function testCreaLaFichaDeUnClienteNuevoSinTocarUnoExistente(): void
    {
        $this->clients->save(new Client('cli-001', 'Nombre Original', 'o@example.com', '+591', 10));
        $this->handler->handle('saga.completed', self::EVENT);
        $this->assertSame('Nombre Original', $this->clients->findById('cli-001')->getFullName());

        $this->handler->handle('saga.completed', [...self::EVENT, 'sagaId' => 's2', 'clientId' => 'nuevo']);
        $this->assertSame('Camila Fernandez', $this->clients->findById('nuevo')->getFullName());
    }

    public function testCanjeAplicaDescuentoYSoloDaPuntosPorLoPagado(): void
    {
        $this->ledger->balances['cli-001'] = 1000;
        $this->assertSame('saga.event.points.reserved', $this->reservePoints(500)[0]['routingKey']);
        $this->assertSame(500, $this->ledger->balanceOf('cli-001'));

        $this->handler->handle('saga.completed', [...self::EVENT, 'discountCents' => 500]);

        $invoice = $this->invoices->findBySagaId('s1');
        $this->assertSame(45.0, $invoice->getSubtotalAmount());
        $this->assertSame(5.0, $invoice->getDiscountAmount());
        $this->assertSame(40.0, $invoice->getTotalAmount());
        $this->assertSame(900, $this->ledger->balanceOf('cli-001')); // 500 restantes + 400 ganados
    }

    public function testCanjeRepetidoNoDescuentaDosVeces(): void
    {
        $this->ledger->balances['cli-001'] = 1000;
        $this->reservePoints(500);
        $this->reservePoints(500);
        $this->assertSame(500, $this->ledger->balanceOf('cli-001'));
    }

    public function testCanjeSinSaldoSuficienteSeRechaza(): void
    {
        $this->ledger->balances['cli-001'] = 100;
        $reply = $this->reservePoints(500)[0];
        $this->assertSame('saga.event.points.reserve_failed', $reply['routingKey']);
        $this->assertSame('POINTS_INSUFFICIENT', $reply['body']['reason']);
        $this->assertSame(100, $this->ledger->balanceOf('cli-001'));
    }

    public function testCanjeNoPuedeDejarUnCobroMenorAlMinimo(): void
    {
        $this->ledger->balances['cli-001'] = 10000;
        $this->assertSame('POINTS_EXCEED_LIMIT', $this->reservePoints(4460)[0]['body']['reason']);
        $this->assertSame(10000, $this->ledger->balanceOf('cli-001'));
    }

    public function testCompensacionDevuelveLosPuntosUnaSolaVez(): void
    {
        $this->ledger->balances['cli-001'] = 1000;
        $this->reservePoints(500);

        $release = ['sagaId' => 's1', 'clientId' => 'cli-001'];
        $this->assertSame('saga.event.points.released', $this->handler->handle('crm.command.points.release', $release)[0]['routingKey']);
        $this->handler->handle('crm.command.points.release', $release);

        $this->assertSame(1000, $this->ledger->balanceOf('cli-001'));
    }

    public function testLiberarSinHaberReservadoNoCambiaElSaldo(): void
    {
        $this->ledger->balances['cli-001'] = 1000;
        $this->handler->handle('crm.command.points.release', ['sagaId' => 's1', 'clientId' => 'cli-001']);
        $this->assertSame(1000, $this->ledger->balanceOf('cli-001'));
    }

    public function testReembolsoEmiteNotaDeCreditoYRevierteLosPuntos(): void
    {
        $this->ledger->balances['cli-001'] = 1000;
        $this->reservePoints(500);
        $this->handler->handle('saga.completed', [...self::EVENT, 'discountCents' => 500]);
        $this->assertSame(900, $this->ledger->balanceOf('cli-001'));

        $reply = $this->handler->handle('crm.command.refund.apply', ['sagaId' => 's1', 'reason' => 'Cancelada'])[0];

        $this->assertSame('saga.event.refund.applied', $reply['routingKey']);
        $this->assertSame('REFUNDED', $this->invoices->findBySagaId('s1')->getStatus());
        $note = array_values($this->invoices->notes)[0];
        $this->assertSame(40.0, $note->amount);
        $this->assertSame(5.2, $note->taxAmount);
        $this->assertSame(1000, $this->ledger->balanceOf('cli-001')); // Vuelve al saldo inicial
    }

    public function testReembolsoRepetidoNoRevierteDosVeces(): void
    {
        $this->handler->handle('saga.completed', self::EVENT);
        $this->ledger->balances['cli-001'] += 100;

        $this->handler->handle('crm.command.refund.apply', ['sagaId' => 's1']);
        $this->handler->handle('crm.command.refund.apply', ['sagaId' => 's1']);

        $this->assertSame(100, $this->ledger->balanceOf('cli-001'));
        $this->assertCount(1, $this->invoices->notes);
    }

    public function testReembolsoNoDejaElSaldoNegativoSiYaGastoLosPuntos(): void
    {
        $this->handler->handle('saga.completed', self::EVENT);
        $this->ledger->balances['cli-001'] = 100;

        $this->handler->handle('crm.command.refund.apply', ['sagaId' => 's1']);

        $this->assertSame(0, $this->ledger->balanceOf('cli-001'));
    }

    public function testReembolsoSinFacturaFallaParaReintentarse(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->handler->handle('crm.command.refund.apply', ['sagaId' => 'sin-factura']);
    }

    public function testAjusteManualDePuntos(): void
    {
        $this->clients->save(new Client('cli-001', 'Camila', 'c@example.com', '', 0));
        $useCase = new AccumulatePointsUseCase($this->clients, $this->ledger);
        $this->assertSame(30, $useCase->execute('cli-001', 30, 'Cortesía'));
    }

    public function testAjusteManualRechazaClienteInexistenteYPuntosInvalidos(): void
    {
        $useCase = new AccumulatePointsUseCase($this->clients, $this->ledger);
        $this->expectException(\InvalidArgumentException::class);
        $useCase->execute('no-existe', 10, 'x');
    }

    public function testAjusteManualRechazaPuntosNoPositivos(): void
    {
        $this->clients->save(new Client('cli-001', 'Camila', 'c@example.com', '', 0));
        $useCase = new AccumulatePointsUseCase($this->clients, $this->ledger);
        $this->expectException(\InvalidArgumentException::class);
        $useCase->execute('cli-001', 0, 'x');
    }

    public function test_el_pago_avisa_al_cliente_una_sola_vez(): void
    {
        $evento = ['sagaId' => 's-aviso', 'clientId' => 'c-1', 'appointmentId' => 'a-1', 'amountCents' => 4500, 'serviceName' => 'Corte'];

        $this->handler->handle('saga.completed', $evento);
        $this->handler->handle('saga.completed', $evento);

        $this->assertCount(1, $this->notices->items);
        $aviso = array_values($this->notices->items)[0];
        $this->assertSame('c-1', $aviso->recipient);
        $this->assertSame('PAYMENT', $aviso->type);
        $this->assertStringContainsString('Corte', $aviso->message);
    }

    public function test_el_reembolso_avisa_al_dueno_de_la_factura(): void
    {
        $this->handler->handle('saga.completed', ['sagaId' => 's-ref', 'clientId' => 'c-2', 'appointmentId' => 'a-2', 'amountCents' => 4500]);

        $this->handler->handle('crm.command.refund.apply', ['sagaId' => 's-ref']);

        $avisos = array_values(array_filter($this->notices->items, fn ($n) => $n->type === 'REFUND'));
        $this->assertCount(1, $avisos);
        $this->assertSame('c-2', $avisos[0]->recipient);
        $this->assertStringContainsString('45.00', $avisos[0]->message);
    }

    public function test_el_stock_critico_avisa_a_los_administradores_una_vez_por_dia(): void
    {
        $this->handler->handle('inventory.stock.critical', ['items' => ['KERAT-1', 'TINT-2']]);
        $this->handler->handle('inventory.stock.critical', ['sagaId' => 's-9', 'items' => ['KERAT-1']]);

        $this->assertCount(2, $this->notices->items);
        foreach ($this->notices->items as $aviso) {
            $this->assertSame('role:ADMIN', $aviso->recipient);
        }
    }

    public function test_ocultar_una_publicacion_avisa_a_su_autor(): void
    {
        $evento = ['postId' => 'p-1', 'authorId' => 'c-3', 'title' => 'Mi look', 'reason' => 'Contenido ofensivo'];

        $this->handler->handle('community.post.hidden', $evento);
        $this->handler->handle('community.post.hidden', $evento);

        $this->assertCount(1, $this->notices->items);
        $aviso = array_values($this->notices->items)[0];
        $this->assertSame('c-3', $aviso->recipient);
        $this->assertStringContainsString('Contenido ofensivo', $aviso->message);
    }
}
