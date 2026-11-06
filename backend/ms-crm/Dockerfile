# Base común: PHP con las extensiones que requieren PostgreSQL y RabbitMQ
FROM php:8.3-cli-alpine AS base
RUN apk add --no-cache postgresql-dev linux-headers \
    && docker-php-ext-install pdo pdo_pgsql sockets bcmath pcntl
WORKDIR /app

# Dependencias de producción
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts --ignore-platform-reqs

# Dependencias de desarrollo, solo para la etapa de pruebas
FROM composer:2 AS vendor-dev
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-autoloader --no-interaction --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --no-scripts --ignore-platform-reqs

# Pruebas: docker build --target test -t salon-ms-crm-test . && docker run --rm salon-ms-crm-test
FROM base AS test
COPY --from=vendor-dev /app .
RUN mkdir -p storage/framework/cache storage/framework/views storage/framework/sessions storage/logs bootstrap/cache \
    && php artisan package:discover
ENV APP_KEY=base64:c2Fsb24tY3JtLWNsYXZlLWRlLXBydWViYXMtMzJieXRlcw==
CMD ["php", "artisan", "test"]

# Imagen de ejecución (etapa por defecto)
FROM base AS runtime
COPY --from=vendor /app .
RUN mkdir -p storage/framework/cache storage/framework/views storage/framework/sessions storage/logs bootstrap/cache \
    && php artisan package:discover
ENV PHP_CLI_SERVER_WORKERS=4
EXPOSE 8000
CMD ["php", "-S", "0.0.0.0:8000", "-t", "public", "public/index.php"]
