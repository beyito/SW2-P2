<?php

namespace App\FrameworksDrivers\Persistence;

use App\InterfaceAdapters\Gateways\CrmMetricsInterface;
use PDO;

class PostgresCrmMetrics implements CrmMetricsInterface
{
    public function __construct(private PDO $pdo)
    {
    }

    public function between(string $from, string $to): array
    {
        // Los ingresos son lo cobrado en el periodo menos lo reembolsado en el periodo
        $stmt = $this->pdo->prepare(
            "WITH period AS (
                SELECT CAST(:from AS date) AS start_at, CAST(:to AS date) + 1 AS end_at
             ), billed AS (
                SELECT COALESCE(SUM(i.total_amount), 0) AS gross, COUNT(*) AS issued, COUNT(DISTINCT i.client_id) AS clients
                FROM invoices i, period p
                WHERE i.issued_at >= p.start_at AND i.issued_at < p.end_at
             ), refunds AS (
                SELECT COALESCE(SUM(n.amount), 0) AS amount
                FROM credit_notes n, period p
                WHERE n.issued_at >= p.start_at AND n.issued_at < p.end_at
             ), points AS (
                SELECT
                    COALESCE(SUM(l.points) FILTER (WHERE l.type = 'ACCUMULATION'), 0) AS earned,
                    COALESCE(SUM(ABS(l.points)) FILTER (WHERE l.type = 'REDEMPTION'), 0) AS redeemed
                FROM loyalty_transactions l, period p
                WHERE l.created_at >= p.start_at AND l.created_at < p.end_at
             )
             SELECT billed.gross, billed.issued, billed.clients, refunds.amount AS refunded,
                    points.earned, points.redeemed, (SELECT COUNT(*) FROM crm_clients) AS total_clients
             FROM billed, refunds, points"
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return [
            'revenue' => round((float) $row['gross'] - (float) $row['refunded'], 2),
            'refunded' => (float) $row['refunded'],
            'invoicesIssued' => (int) $row['issued'],
            'payingClients' => (int) $row['clients'],
            'totalClients' => (int) $row['total_clients'],
            'pointsEarned' => (int) $row['earned'],
            'pointsRedeemed' => (int) $row['redeemed'],
        ];
    }
}
