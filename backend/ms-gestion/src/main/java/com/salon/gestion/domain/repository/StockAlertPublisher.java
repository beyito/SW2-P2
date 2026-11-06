package com.salon.gestion.domain.repository;

import java.util.List;

/**
 * Puerto de salida: avisa que unos insumos quedaron en nivel crítico (RF-03).
 */
public interface StockAlertPublisher {
    void publishCritical(List<String> itemCodes);
}
