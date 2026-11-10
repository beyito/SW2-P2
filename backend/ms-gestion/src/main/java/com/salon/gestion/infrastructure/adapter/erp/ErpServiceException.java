package com.salon.gestion.infrastructure.adapter.erp;

/**
 * Un microservicio rechazó la petición que la puerta GraphQL del ERP le reenvió. Conserva el código HTTP
 * para elegir el tipo de error GraphQL y el mensaje real del servicio para mostrarlo.
 */
public class ErpServiceException extends RuntimeException {

    private final int status;

    public ErpServiceException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }
}
