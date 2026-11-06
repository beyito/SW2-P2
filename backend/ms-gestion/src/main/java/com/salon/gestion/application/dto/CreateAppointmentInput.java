package com.salon.gestion.application.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateAppointmentInput {
    private String clientId;
    private String stylistId;
    private String serviceName;
    private String appointmentDate;
    private Integer durationMinutes;
    private Double totalPrice;
    private String notes;
}
