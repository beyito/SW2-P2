/// Direcciones de la plataforma. En un emulador o teléfono por USB, "adb reverse" hace que
/// localhost llegue al equipo: Keycloak exige que el emisor del token siempre sea el mismo.
/// En la nube cada servicio tiene su propia dirección pública, que se pasa al compilar con
/// --dart-define (por ejemplo GESTION_URL=https://api-gestion.dominio/graphql).
class Config {
  static const _host = String.fromEnvironment('SALON_HOST', defaultValue: 'http://localhost');
  static const keycloakIssuer = String.fromEnvironment('KEYCLOAK_ISSUER', defaultValue: '$_host:8080/realms/salon');
  static const asesoria = String.fromEnvironment('ASESORIA_URL', defaultValue: '$_host:3100');
  static const ia = String.fromEnvironment('IA_URL', defaultValue: '$_host:8002/api/v1');
  static const gestion = String.fromEnvironment('GESTION_URL', defaultValue: '$_host:8081/graphql');
  static const crm = String.fromEnvironment('CRM_URL', defaultValue: '$_host:8083/graphql');
  static const saga = String.fromEnvironment('SAGA_URL', defaultValue: '$_host:4100');
  static const clientId = 'salon-mobile';
  static const redirectUrl = 'com.salon.mobile://callback';
}
