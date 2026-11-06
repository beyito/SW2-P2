package com.salon.gestion.infrastructure.adapter.graphql;

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
