FROM php:8.3-cli-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-dev \
    && docker-php-ext-install pdo pdo_pgsql

COPY composer.json index.php ./
COPY app/ ./app/
COPY graphql/ ./graphql/

EXPOSE 8000

CMD ["php", "-S", "0.0.0.0:8000"]
