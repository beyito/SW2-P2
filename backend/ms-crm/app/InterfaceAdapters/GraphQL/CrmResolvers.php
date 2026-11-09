<?php

namespace App\InterfaceAdapters\GraphQL;

use App\Core\Entities\Client;
use App\Core\Entities\Notice;
use App\Core\UseCases\AccumulatePointsUseCase;
use App\Core\UseCases\RecordNoticesUseCase;
use App\Core\UseCases\RegisterClientUseCase;
use App\Core\UseCases\UpdateStyleProfileUseCase;
use App\InterfaceAdapters\Gateways\ClientRepositoryInterface;
use App\InterfaceAdapters\Gateways\CrmMetricsInterface;
use App\InterfaceAdapters\Gateways\InvoiceRepositoryInterface;
use App\InterfaceAdapters\Gateways\LoyaltyLedgerInterface;
use App\InterfaceAdapters\Gateways\NoticeRepositoryInterface;
use App\InterfaceAdapters\Gateways\PushDeviceRepositoryInterface;
use Nuwave\Lighthouse\Support\Contracts\GraphQLContext;

/**
 * Adaptador GraphQL del CRM. La identidad y los roles salen siempre del token validado.
 */
class CrmResolvers
{
    public function __construct(
        private ClientRepositoryInterface $clients,
        private InvoiceRepositoryInterface $invoices,
        private LoyaltyLedgerInterface $ledger,
        private RegisterClientUseCase $registerClient,
        private AccumulatePointsUseCase $accumulatePoints,
        private NoticeRepositoryInterface $notices,
        private CrmMetricsInterface $metrics,
        private UpdateStyleProfileUseCase $updateStyleProfile,
        private RecordNoticesUseCase $recordNotices,
        private PushDeviceRepositoryInterface $pushDevices
    ) {
    }

    /** Un token de FCM tiene más de 100 caracteres y nunca espacios. */
    private const PUSH_TOKEN = '/^[A-Za-z0-9_:\-]{100,255}$/';

    public function registerPushToken($root, array $args, GraphQLContext $context): bool
    {
        if (!preg_match(self::PUSH_TOKEN, $args['token'])) {
            throw new CrmForbidden('El token del teléfono no es válido.', 'INVALID_TOKEN');
        }
        $this->pushDevices->register($args['token'], $this->userId($context), in_array('ADMIN', $this->roles($context), true));
        return true;
    }

    public function unregisterPushToken($root, array $args, GraphQLContext $context): bool
    {
        $this->pushDevices->remove($args['token']);
        return true;
    }

    public function getClients($root, array $args, GraphQLContext $context): array
    {
        $this->assertStaff($context);
        return array_map([CrmPresenter::class, 'client'], $this->clients->findAll());
    }

    public function getClientById($root, array $args, GraphQLContext $context): ?array
    {
        $this->assertSelfOrStaff($context, $args['id']);
        return CrmPresenter::client($this->clients->findById($args['id']));
    }

    public function getClientByEmail($root, array $args, GraphQLContext $context): ?array
    {
        $this->assertStaff($context);
        return CrmPresenter::client($this->clients->findByEmail($args['email']));
    }

    public function getMyProfile($root, array $args, GraphQLContext $context): ?array
    {
        return CrmPresenter::ownClient($this->clients->findById($this->userId($context)));
    }

    public function getClientPoints($root, array $args, GraphQLContext $context): int
    {
        $this->assertSelfOrStaff($context, $args['clientId']);
        return $this->ledger->balanceOf($args['clientId']);
    }

    public function getLoyaltyHistory($root, array $args, GraphQLContext $context): array
    {
        $this->assertSelfOrStaff($context, $args['clientId']);
        return $this->ledger->historyOf($args['clientId']);
    }

    public function getInvoiceById($root, array $args, GraphQLContext $context): ?array
    {
        $invoice = $this->invoices->findById($args['id']);
        if ($invoice) {
            $this->assertSelfOrStaff($context, $invoice->getClientId());
        }
        return CrmPresenter::invoice($invoice);
    }

    public function getInvoicesByClient($root, array $args, GraphQLContext $context): array
    {
        $this->assertSelfOrStaff($context, $args['clientId']);
        return array_map([CrmPresenter::class, 'invoice'], $this->invoices->findByClientId($args['clientId']));
    }

    public function getCreditNotesByClient($root, array $args, GraphQLContext $context): array
    {
        $this->assertSelfOrStaff($context, $args['clientId']);
        return array_map([CrmPresenter::class, 'creditNote'], $this->invoices->creditNotesOf($args['clientId']));
    }

    public function registerClient($root, array $args, GraphQLContext $context): array
    {
        $this->assertStaff($context);
        $input = $args['input'];
        try {
            return CrmPresenter::client($this->registerClient->execute($input['fullName'], $input['email'], $input['phone']));
        } catch (\DomainException $error) {
            throw new CrmForbidden($error->getMessage(), 'CONFLICT');
        }
    }

    public function updateMyStyleProfile($root, array $args, GraphQLContext $context): array
    {
        try {
            return CrmPresenter::ownClient($this->updateStyleProfile->execute($this->accountData($context), $args['input']));
        } catch (\InvalidArgumentException $error) {
            throw new CrmForbidden($error->getMessage(), 'BAD_REQUEST');
        }
    }

    public function setMyWhatsappOptIn($root, array $args, GraphQLContext $context): array
    {
        $this->clients->createIfAbsent($this->accountData($context));
        $this->clients->updateWhatsappOptIn($this->userId($context), $args['enabled']);
        return CrmPresenter::ownClient($this->clients->findById($this->userId($context)));
    }

    public function recordAutomationNotice($root, array $args, GraphQLContext $context): bool
    {
        if (!in_array('ADMIN', $this->roles($context), true)) {
            throw new CrmForbidden('Solo una cuenta de automatización puede crear estos avisos.');
        }
        return $this->recordNotices->automation($args['recipient'], $args['title'], $args['message'], $args['sourceRef']);
    }

    public function syncMyProfile($root, array $args, GraphQLContext $context): array
    {
        $id = $this->userId($context);
        $this->clients->createIfAbsent($this->accountData($context, $args['phone'] ?? ''));
        if (isset($args['phone'])) {
            $this->clients->updatePhone($id, $args['phone']);
        }
        return CrmPresenter::client($this->clients->findById($id));
    }

    public function accumulatePoints($root, array $args, GraphQLContext $context): int
    {
        if (!in_array('ADMIN', $this->roles($context), true)) {
            throw new CrmForbidden('Solo un administrador puede ajustar puntos.');
        }
        try {
            return $this->accumulatePoints->execute($args['clientId'], $args['points'], $args['description']);
        } catch (\InvalidArgumentException $error) {
            throw new CrmForbidden($error->getMessage(), 'BAD_REQUEST');
        }
    }

    public function getMyNotices($root, array $args, GraphQLContext $context): array
    {
        return array_map([CrmPresenter::class, 'notice'], $this->notices->forRecipients($this->noticeRecipients($context)));
    }

    public function markNoticeRead($root, array $args, GraphQLContext $context): bool
    {
        if (!$this->notices->markRead($args['id'], $this->noticeRecipients($context))) {
            throw new CrmForbidden('El aviso no existe.', 'NOT_FOUND');
        }
        return true;
    }

    public function getCrmMetrics($root, array $args, GraphQLContext $context): array
    {
        if (!in_array('ADMIN', $this->roles($context), true)) {
            throw new CrmForbidden('Solo un administrador puede consultar los indicadores.');
        }
        foreach ([$args['from'], $args['to']] as $date) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
            if (!$parsed || $parsed->format('Y-m-d') !== $date) {
                throw new CrmForbidden('Fecha inválida: use el formato AAAA-MM-DD.', 'BAD_REQUEST');
            }
        }
        if ($args['to'] < $args['from']) {
            throw new CrmForbidden('La fecha final no puede ser anterior a la inicial.', 'BAD_REQUEST');
        }
        return $this->metrics->between($args['from'], $args['to']);
    }

    /** El propio usuario y los roles que reciben avisos colectivos. */
    private function noticeRecipients(GraphQLContext $context): array
    {
        $recipients = [$this->userId($context)];
        if (in_array('ADMIN', $this->roles($context), true)) {
            $recipients[] = Notice::ADMINS;
        }
        return $recipients;
    }

    private function claims(GraphQLContext $context): array
    {
        return $context->request()->attributes->get('claims', []);
    }

    /** Ficha nueva con los datos de la cuenta, para quien todavía no la tiene en el CRM. */
    private function accountData(GraphQLContext $context, string $phone = ''): Client
    {
        $claims = $this->claims($context);
        $id = $this->userId($context);
        return new Client(
            id: $id,
            fullName: $claims['name'] ?? $claims['preferred_username'] ?? 'Cliente',
            email: $claims['email'] ?? "{$id}@sin-correo.local",
            phone: $phone
        );
    }

    private function roles(GraphQLContext $context): array
    {
        return $this->claims($context)['realm_access']['roles'] ?? [];
    }

    private function userId(GraphQLContext $context): string
    {
        $claims = $this->claims($context);
        return $claims['salon_id'] ?? $claims['sub'];
    }

    private function isStaff(GraphQLContext $context): bool
    {
        return array_intersect(['ADMIN', 'STYLIST', 'RECEPTIONIST'], $this->roles($context)) !== [];
    }

    private function assertStaff(GraphQLContext $context): void
    {
        if (!$this->isStaff($context)) {
            throw new CrmForbidden('Rol insuficiente para esta operación.');
        }
    }

    private function assertSelfOrStaff(GraphQLContext $context, string $clientId): void
    {
        if (!$this->isStaff($context) && $this->userId($context) !== $clientId) {
            throw new CrmForbidden('No puede acceder a los datos de otro cliente.');
        }
    }
}
