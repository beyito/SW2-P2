<?php

namespace App\InterfaceAdapters\Gateways;

use App\Core\Entities\Notice;

interface NoticeRepositoryInterface
{
    /** Guarda el aviso; si ya existe uno con la misma referencia no hace nada y devuelve falso. */
    public function addOnce(Notice $notice): bool;
    /**
     * @param string[] $recipients
     * @return Notice[] Los más recientes primero.
     */
    public function forRecipients(array $recipients): array;
    /**
     * @param string[] $recipients
     * @return bool Falso si el aviso no existe o no pertenece a esos destinatarios.
     */
    public function markRead(string $id, array $recipients): bool;
}
