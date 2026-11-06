"""
Prueba en vivo de RNF-01: las consultas GraphQL no deben superar los 200 ms.
Incluye el costo real de validar el token y consultar la sesión en DynamoDB.
Requiere el entorno levantado: docker compose up -d --wait
"""
import time

import httpx

from test_seguridad_live import ADMIN, GESTION, auth, login

QUERY = "{getAllInventory{id code name currentStock minimumStock isCriticalStock}}"
CALENTAMIENTO = 3
MEDICIONES = 20


def test_rnf_01_latencia_graphql():
    headers = auth(login(ADMIN))
    latencias = []
    with httpx.Client() as client:
        for _ in range(CALENTAMIENTO):
            client.post(GESTION, json={"query": QUERY}, headers=headers)
        for _ in range(MEDICIONES):
            inicio = time.perf_counter()
            response = client.post(GESTION, json={"query": QUERY}, headers=headers)
            latencias.append((time.perf_counter() - inicio) * 1000)
            assert response.status_code == 200
            assert "errors" not in response.json()

    latencias.sort()
    p95 = latencias[int(len(latencias) * 0.95) - 1]
    print(f"[RNF-01] promedio={sum(latencias) / len(latencias):.1f} ms, p95={p95:.1f} ms, maximo={latencias[-1]:.1f} ms")
    assert p95 < 200
