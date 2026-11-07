"""
Script de Inicialización de Tablas en DynamoDB Local
Tablas: ActiveUserSessions (RF-01, CU-01) e IdempotencyKeys (RNF-04, RF-07)
"""

import json
import os
import urllib.request
import sys

DYNAMODB_URL = os.environ.get("DYNAMODB_ENDPOINT", "http://localhost:8000")

def send_dynamo_request(target: str, payload: dict) -> dict:
    headers = {
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": f"DynamoDB_20120810.{target}",
        "Authorization": "AWS4-HMAC-SHA256 Credential=dummy/20261102/us-east-1/dynamodb/aws4_request, SignedHeaders=host;x-amz-date;x-amz-target, Signature=dummy"
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(DYNAMODB_URL, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        if "ResourceInUseException" in error_body:
            return {"status": "ALREADY_EXISTS"}
        print(f"Error HTTP {e.code} en {target}: {error_body}")
        sys.exit(1)

def create_tables():
    print("Iniciando aprovisionamiento en DynamoDB Local...")

    # 1. Tabla: ActiveUserSessions (Control de Sesión Única Concurrente RF-01)
    session_table = {
        "TableName": "ActiveUserSessions",
        "KeySchema": [
            {"AttributeName": "userId", "KeyType": "HASH"}
        ],
        "AttributeDefinitions": [
            {"AttributeName": "userId", "AttributeType": "S"}
        ],
        "BillingMode": "PAY_PER_REQUEST"
    }
    res1 = send_dynamo_request("CreateTable", session_table)
    print("Tabla 'ActiveUserSessions':", res1.get("TableDescription", {}).get("TableStatus", res1.get("status")))

    # 2. Tabla: IdempotencyKeys (RNF-04 - Idempotencia en Pagos y Reservas SAGA)
    idempotency_table = {
        "TableName": "IdempotencyKeys",
        "KeySchema": [
            {"AttributeName": "idempotencyKey", "KeyType": "HASH"}
        ],
        "AttributeDefinitions": [
            {"AttributeName": "idempotencyKey", "AttributeType": "S"}
        ],
        "BillingMode": "PAY_PER_REQUEST"
    }
    res2 = send_dynamo_request("CreateTable", idempotency_table)
    print("Tabla 'IdempotencyKeys':", res2.get("TableDescription", {}).get("TableStatus", res2.get("status")))

    # 3. Tabla: SagaInstances (Estado persistente de la SAGA de reserva y pago, RF-07)
    saga_table = {
        "TableName": "SagaInstances",
        "KeySchema": [
            {"AttributeName": "sagaId", "KeyType": "HASH"}
        ],
        "AttributeDefinitions": [
            {"AttributeName": "sagaId", "AttributeType": "S"}
        ],
        "BillingMode": "PAY_PER_REQUEST"
    }
    res3 = send_dynamo_request("CreateTable", saga_table)
    print("Tabla 'SagaInstances':", res3.get("TableDescription", {}).get("TableStatus", res3.get("status")))

    # Cupo diario de imágenes generadas, porque cada una tiene un costo real
    quota_table = {
        "TableName": "ImageGenerationQuota",
        "KeySchema": [
            {"AttributeName": "quotaKey", "KeyType": "HASH"}
        ],
        "AttributeDefinitions": [
            {"AttributeName": "quotaKey", "AttributeType": "S"}
        ],
        "BillingMode": "PAY_PER_REQUEST"
    }
    res4 = send_dynamo_request("CreateTable", quota_table)
    print("Tabla 'ImageGenerationQuota':", res4.get("TableDescription", {}).get("TableStatus", res4.get("status")))

    # 4. Listar Tablas creadas
    tables = send_dynamo_request("ListTables", {})
    print("Tablas activas en DynamoDB Local:", tables.get("TableNames", []))

    # 5. Insertar item semilla en IdempotencyKeys para prueba
    sample_item = {
        "TableName": "IdempotencyKeys",
        "Item": {
            "idempotencyKey": {"S": "test-key-001"},
            "status": {"S": "COMPLETED"},
            "requestPayloadHash": {"S": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
            "responseBody": {"S": "{\"appointmentId\": \"app-123\", \"status\": \"CONFIRMED\"}"},
            "ttl": {"N": "1730600000"}
        }
    }
    send_dynamo_request("PutItem", sample_item)
    print("Semilla de idempotencia insertada con éxito.")

if __name__ == "__main__":
    create_tables()
