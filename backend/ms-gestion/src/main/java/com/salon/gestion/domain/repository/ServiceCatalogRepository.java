package com.salon.gestion.domain.repository;

import com.salon.gestion.domain.model.SalonService;
import com.salon.gestion.domain.model.ServiceSupply;
import com.salon.gestion.domain.model.Stylist;

import java.util.List;
import java.util.Optional;

/**
 * Puerto de Dominio (DDD): catálogo de servicios, recetas y estilistas.
 */
public interface ServiceCatalogRepository {
    List<SalonService> findActiveServices();
    Optional<SalonService> findActiveById(String id);
    List<ServiceSupply> findSupplies(String serviceId);
    List<Stylist> findStylists();
}
