package com.salon.gestion.infrastructure.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Seguridad de ms-gestion: toda consulta GraphQL exige un token válido de Keycloak (RF-01).
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationConverter converter) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> { })
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**", "/graphiql/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))
                .build();
    }

    @Bean
    JwtDecoder jwtDecoder(
            @Value("${salon.security.jwks-uri}") String jwksUri,
            @Value("${salon.security.issuer}") String issuer,
            @Value("${salon.security.audience}") String audience,
            SessionRegistry sessionRegistry) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwksUri)
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(),
                new JwtIssuerValidator(issuer),
                audienceValidator(audience),
                new ActiveSessionValidator(sessionRegistry)));
        return decoder;
    }

    /** Traduce los roles de Keycloak (realm_access.roles) a autoridades de Spring. */
    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(SecurityConfig::realmRoles);
        return converter;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${salon.security.allowed-origins}") List<String> origins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    static OAuth2TokenValidator<Jwt> audienceValidator(String audience) {
        return token -> token.getAudience() != null && token.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Audiencia no válida", null));
    }

    @SuppressWarnings("unchecked")
    static Collection<GrantedAuthority> realmRoles(Jwt token) {
        Map<String, Object> realmAccess = token.getClaimAsMap("realm_access");
        if (realmAccess == null) {
            return List.of();
        }
        return ((List<String>) realmAccess.getOrDefault("roles", List.of())).stream()
                .map(role -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role))
                .toList();
    }
}
