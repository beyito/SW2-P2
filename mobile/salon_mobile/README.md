# Aplicación móvil: salon_mobile

Flutter para Android e iOS. Inicia sesión con Keycloak y funciona sin conexión (RF-10, CU-13, CU-22).

- **Diagnóstico:** en línea analiza `ms-ia`; sin conexión analiza el dispositivo, con los mismos modelos de MediaPipe y el clasificador propio en TFLite. Solo se guarda el resultado, nunca la foto.
- **Cola local:** SQLite, con orden, `Idempotency-Key` y envío automático al recuperar la red. Cada usuario tiene su base. Sin conexión se puede reservar, reaccionar, comentar, cancelar y reprogramar; los rechazos del servidor, incluidos los de GraphQL, quedan como conflicto visible.
- **Comprobantes:** se imprimen o guardan en PDF también sin conexión, con la última copia de las facturas.
- **Lecturas:** se muestra sin conexión lo último que se vio.

## Preparación

```powershell
flutter pub get
dart run tool/fetch_models.dart
```

## Ejecución en emulador o teléfono por USB

Los servicios corren en el equipo; `adb reverse` hace que `localhost` llegue a ellos:

```powershell
foreach ($p in 8080,8081,3100,8002,8083,4100) { adb reverse tcp:$p tcp:$p }
flutter run
```

## Contra la nube

Sin `adb reverse`: se compila con las direcciones públicas. `bash deploy/gcp/desplegar.sh` imprime el comando completo al terminar. Con el despliegue actual:

```powershell
flutter build apk --debug `
  --dart-define=KEYCLOAK_ISSUER=https://auth.salon-ai.beauty/realms/salon `
  --dart-define=GESTION_URL=https://gestion.salon-ai.beauty/graphql `
  --dart-define=CRM_URL=https://salon-crm.thankfulsmoke-2167cdc2.canadacentral.azurecontainerapps.io/graphql `
  --dart-define=ASESORIA_URL=https://salon-asesoria-qfdwhthkma-uk.a.run.app `
  --dart-define=IA_URL=https://salon-ia-qfdwhthkma-uk.a.run.app/api/v1 `
  --dart-define=SAGA_URL=https://salon-saga.thankfulsmoke-2167cdc2.canadacentral.azurecontainerapps.io
adb install -r build\app\outputs\flutter-apk\app-debug.apk
```

El APK release falla en Gradle; el debug funciona. En la nube, las cuentas de demostración tienen otras contraseñas: ver `MANUAL_EJECUCION.md`, sección 6.

## Pruebas

```powershell
flutter test
flutter test integration_test/app_offline_test.dart -d emulator-5554
```

La prueba de integración usa los modelos reales y los servicios reales.

La de reserva y pago necesita la clave de prueba de Stripe, que paga con la tarjeta de prueba directamente en su API. Reserva un lunes de marzo de 2041:

```powershell
flutter test integration_test/booking_real_test.dart -d emulator-5554 --dart-define=STRIPE_TEST_SECRET=<su sk_test>
```

Al terminar, borre lo que creó: la cita de 2041 en `salon_gestion` y su factura y puntos en `salon_crm`, que se buscan por el `sagaId` que imprime la prueba.

## Pantallas

Diagnóstico, Clóset, Mis citas (reservar con canje de puntos y pagar con el formulario de Stripe, pagar una reserva pendiente, reprogramar y cancelar con reembolso), Comunidad (publicar, reaccionar y comentar) y Cuenta (puntos, facturas con comprobante para imprimir o guardar en PDF, y asesoría para redes). Cerrar sesión revoca la sesión en los servicios y en Keycloak.
