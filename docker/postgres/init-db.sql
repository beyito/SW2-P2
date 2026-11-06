-- ====================================================================
-- Script de Inicialización de Bases de Datos para Microservicios
-- Plataforma Inteligente para Salón de Belleza y Asesoramiento IA
-- ====================================================================

-- Base de datos para Microservicio 1: ms-gestion (Spring Boot + DDD)
CREATE DATABASE salon_gestion;

-- Base de datos para Microservicio 3: ms-crm (Laravel + Clean Architecture)
CREATE DATABASE salon_crm;

-- Permisos iniciales
GRANT ALL PRIVILEGES ON DATABASE salon_gestion TO salon_admin;
GRANT ALL PRIVILEGES ON DATABASE salon_crm TO salon_admin;
