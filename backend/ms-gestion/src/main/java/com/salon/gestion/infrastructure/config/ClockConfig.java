package com.salon.gestion.infrastructure.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

/**
 * Reloj en la zona horaria del salón: las citas se guardan en hora local.
 */
@Configuration
public class ClockConfig {

    @Bean
    Clock salonClock(@Value("${salon.timezone:America/La_Paz}") String timezone) {
        return Clock.system(ZoneId.of(timezone));
    }
}
