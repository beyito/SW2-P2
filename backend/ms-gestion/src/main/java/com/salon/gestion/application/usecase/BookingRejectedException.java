package com.salon.gestion.application.usecase;

/**
 * Rechazo de negocio dentro de la SAGA: no se reintenta y dispara la compensación.
 */
public class BookingRejectedException extends RuntimeException {

    private final String reason;

    public BookingRejectedException(String reason, String message) {
        super(message);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
