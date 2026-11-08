<?php

namespace Tests;

use App\FrameworksDrivers\Security\AwsSigV4;
use PHPUnit\Framework\TestCase;

/**
 * Firma SigV4 de las llamadas a DynamoDB. Las firmas de referencia se calcularon con botocore,
 * el SDK oficial de AWS; la primera es el ejemplo de su documentación.
 */
class AwsSigV4Test extends TestCase
{
    private const BODY = '{"TableName":"IdempotencyKeys","Key":{"idempotencyKey":{"S":"k1"}}}';
    private const DYNAMO_HEADERS = [
        'Content-Type' => 'application/x-amz-json-1.0',
        'X-Amz-Target' => 'DynamoDB_20120810.GetItem',
    ];

    private static function credentials(?string $token = null): array
    {
        return [
            'accessKeyId' => 'AKIDEXAMPLE',
            'secretAccessKey' => 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
            'sessionToken' => $token,
            'region' => 'us-east-1',
        ];
    }

    private static function signatureOf(array $headers): string
    {
        return explode('Signature=', $headers['Authorization'])[1];
    }

    public function testCoincideConElEjemploOficialDeAws(): void
    {
        $headers = AwsSigV4::sign(
            'GET',
            'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
            ['Content-Type' => 'application/x-www-form-urlencoded; charset=utf-8'],
            '',
            'iam',
            self::credentials(),
            new \DateTimeImmutable('2015-08-30T12:36:00Z'),
        );
        $this->assertSame('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7', self::signatureOf($headers));
        $this->assertStringContainsString('SignedHeaders=content-type;host;x-amz-date,', $headers['Authorization']);
    }

    public function testFirmaUnaPeticionADynamoIgualQueBotocore(): void
    {
        $headers = AwsSigV4::sign(
            'POST', 'https://dynamodb.us-east-1.amazonaws.com/', self::DYNAMO_HEADERS, self::BODY,
            'dynamodb', self::credentials(), new \DateTimeImmutable('2026-11-08T12:00:00Z'),
        );
        $this->assertSame('0060c4fedcd6b015779df0310009d61d2a0292ab4a73876a4658dbcfd865302b', self::signatureOf($headers));
        $this->assertSame('20261108T120000Z', $headers['X-Amz-Date']);
    }

    public function testIncluyeTokenDeSesionYPuertoComoDynamoLocal(): void
    {
        $headers = AwsSigV4::sign(
            'POST', 'http://dynamodb-local:8000', self::DYNAMO_HEADERS, self::BODY,
            'dynamodb', self::credentials('TOKENDEPRUEBA'), new \DateTimeImmutable('2026-11-08T12:00:00Z'),
        );
        $this->assertSame('1cf0677b1ea0123acd9eb58375af484969150eac21329afdc760541e51275ba3', self::signatureOf($headers));
        $this->assertSame('TOKENDEPRUEBA', $headers['X-Amz-Security-Token']);
    }

    public function testSinCredencialesUsaLasDeRellenoDeDynamoLocal(): void
    {
        $this->assertSame(
            ['accessKeyId' => 'local', 'secretAccessKey' => 'local', 'sessionToken' => null, 'region' => 'us-east-1'],
            AwsSigV4::credentialsFromEnv([]),
        );
        $this->assertSame('us-east-2', AwsSigV4::credentialsFromEnv(['AWS_REGION' => 'us-east-2'])['region']);
    }
}
