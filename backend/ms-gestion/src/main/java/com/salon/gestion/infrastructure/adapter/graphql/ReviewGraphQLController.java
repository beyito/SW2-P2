package com.salon.gestion.infrastructure.adapter.graphql;

import com.salon.gestion.application.dto.CreateReviewInput;
import com.salon.gestion.application.usecase.ReviewUseCase;
import com.salon.gestion.domain.model.Review;
import com.salon.gestion.infrastructure.security.AppointmentAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.util.List;

/**
 * Adaptador de Entrada GraphQL: reseñas de estilistas. El autor siempre sale del token.
 */
@Controller
@RequiredArgsConstructor
public class ReviewGraphQLController {

    private final ReviewUseCase reviews;
    private final AppointmentAccess access;

    @MutationMapping
    public Review createReview(@Argument CreateReviewInput input, Authentication authentication) {
        return reviews.create(access.salonId(authentication), input);
    }

    @QueryMapping
    public List<Review> getStylistReviews(@Argument String stylistId) {
        return reviews.ofStylist(stylistId);
    }
}
