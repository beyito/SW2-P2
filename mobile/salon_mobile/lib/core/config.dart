/// Direcciones de la plataforma. En un emulador o teléfono por USB, "adb reverse" hace que
/// localhost llegue al equipo: Keycloak exige que el emisor del token siempre sea el mismo.
class Config {
  static const _host = String.fromEnvironment('SALON_HOST', defaultValue: 'http://localhost');
  static const keycloakIssuer = String.fromEnvironment('KEYCLOAK_ISSUER', defaultValue: '$_host:8080/realms/salon');
  static const asesoria = '$_host:3100';
  static const ia = '$_host:8002/api/v1';
  static const gestion = '$_host:8081/graphql';
  static const crm = '$_host:8083/graphql';
  static const saga = '$_host:4100';
  static const clientId = 'salon-mobile';
  static const redirectUrl = 'com.salon.mobile://callback';
}
