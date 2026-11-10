package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.infrastructure.adapter.erp.ErpServiceException;
import graphql.ErrorClassification;
import graphql.GraphQLError;
import graphql.GraphqlErrorBuilder;
import graphql.schema.DataFetchingEnvironment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.graphql.execution.DataFetcherExceptionResolverAdapter;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.stereotype.Component;

/**
 * Traduce los errores de negocio a errores GraphQL semánticos en lugar de INTERNAL_ERROR.
 */
@Component
public class DomainExceptionResolver extends DataFetcherExceptionResolverAdapter {

    private static final ErrorClassification CONFLICT = ErrorClassification.errorClassification("CONFLICT");

    @Override
    protected GraphQLError resolveToSingleError(Throwable error, DataFetchingEnvironment environment) {
        // Un servicio detrás de la puerta del ERP rechazó la petición: se conserva su mensaje real
        if (error instanceof ErpServiceException rejected) {
            ErrorClassification type = switch (rejected.status()) {
                case 401 -> ErrorType.UNAUTHORIZED;
                case 403 -> ErrorType.FORBIDDEN;
                case 404 -> ErrorType.NOT_FOUND;
                case 409 -> CONFLICT;
                default -> rejected.status() >= 500 ? ErrorType.INTERNAL_ERROR : ErrorType.BAD_REQUEST;
            };
            return build(environment, type, error.getMessage());
        }
        if (error instanceof IllegalArgumentException) {
            return build(environment, ErrorType.BAD_REQUEST, error.getMessage());
        }
        if (error instanceof IllegalStateException) {
            return build(environment, CONFLICT, error.getMessage());
        }
        if (error instanceof DataIntegrityViolationException) {
            return build(environment, CONFLICT, "La operación entra en conflicto con los datos existentes");
        }
        return null;
    }

    private GraphQLError build(DataFetchingEnvironment environment, ErrorClassification type, String message) {
        return GraphqlErrorBuilder.newError(environment).errorType(type).message(message).build();
    }
}
