"""Firma SigV4 de las llamadas a DynamoDB.

Las firmas de referencia se calcularon con botocore, el SDK oficial de AWS; la primera es el ejemplo de su documentación.
"""
from datetime import datetime, timezone

from app.adapters.aws_sigv4 import Credentials, credentials_from_env, sign_request

BODY = b'{"TableName":"IdempotencyKeys","Key":{"idempotencyKey":{"S":"k1"}}}'
DYNAMO_HEADERS = {"Content-Type": "application/x-amz-json-1.0", "X-Amz-Target": "DynamoDB_20120810.GetItem"}
FECHA = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)


def credenciales(token=None):
    return Credentials("AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", token, "us-east-1")


def firma(headers):
    return headers["Authorization"].split("Signature=")[1]


def test_coincide_con_el_ejemplo_oficial_de_aws():
    headers = sign_request(
        "GET", "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
        {"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"}, b"", "iam", credenciales(),
        datetime(2015, 8, 30, 12, 36, tzinfo=timezone.utc),
    )
    assert firma(headers) == "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
    assert "SignedHeaders=content-type;host;x-amz-date," in headers["Authorization"]


def test_firma_una_peticion_a_dynamo_igual_que_botocore():
    headers = sign_request("POST", "https://dynamodb.us-east-1.amazonaws.com/", DYNAMO_HEADERS, BODY,
                           "dynamodb", credenciales(), FECHA)
    assert firma(headers) == "0060c4fedcd6b015779df0310009d61d2a0292ab4a73876a4658dbcfd865302b"
    assert headers["X-Amz-Date"] == "20261108T120000Z"


def test_incluye_token_de_sesion_y_puerto_como_dynamo_local():
    headers = sign_request("POST", "http://dynamodb-local:8000", DYNAMO_HEADERS, BODY,
                           "dynamodb", credenciales("TOKENDEPRUEBA"), FECHA)
    assert firma(headers) == "1cf0677b1ea0123acd9eb58375af484969150eac21329afdc760541e51275ba3"
    assert headers["X-Amz-Security-Token"] == "TOKENDEPRUEBA"


def test_sin_credenciales_usa_las_de_relleno_de_dynamo_local():
    assert credentials_from_env({}) == Credentials("local", "local", None, "us-east-1")
    assert credentials_from_env({"AWS_REGION": "us-east-2"}).region == "us-east-2"
