<?php

namespace Tests;

use PHPUnit\Framework\TestCase;
use App\Core\UseCases\GenerateInvoiceUseCase;
use App\Core\Entities\Invoice;
use App\Core\Entities\Client;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;

class GenerateInvoiceUseCaseTest extends TestCase
{
    public function testGenerateInvoiceSuccessfully(): void
    {
        $client = new Client('cli_999', 'Lucia Mendez', 'lucia@example.com', '+591 79876543', 10);

        $mockClientRepo = $this->createMock(ClientRepositoryInterface::class);
        $mockClientRepo->expects($this->once())
            ->method('findById')
            ->with('cli_999')
            ->willReturn($client);

        $mockInvoiceRepo = $this->createMock(InvoiceRepositoryInterface::class);
        $mockInvoiceRepo->expects($this->once())
            ->method('save')
            ->willReturnCallback(function (Invoice $invoice) {
                return $invoice;
            });

        $useCase = new GenerateInvoiceUseCase($mockInvoiceRepo, $mockClientRepo);
        $invoice = $useCase->execute('apt-501', 'cli_999', 150.00, 'CREDIT_CARD');

        $this->assertInstanceOf(Invoice::class, $invoice);
        $this->assertEquals('apt-501', $invoice->getAppointmentId());
        $this->assertEquals('cli_999', $invoice->getClientId());
        $this->assertEquals('Lucia Mendez', $invoice->getClientName());
        $this->assertEquals(150.00, $invoice->getTotalAmount());
        $this->assertEquals('CREDIT_CARD', $invoice->getPaymentMethod());
        $this->assertStringStartsWith('inv_', $invoice->getId());
    }
}
