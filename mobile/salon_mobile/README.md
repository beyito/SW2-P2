# Aplicación móvil: salon_mobile

Flutter para Android e iOS. Inicia sesión con Keycloak y funciona sin conexión (RF-10, CU-13, CU-22).

- **Diagnóstico:** en línea analiza `ms-ia`; sin conexión analiza el dispositivo, con los mismos modelos de MediaPipe y el clasificador propio en TFLite. Solo se guarda el resultado, nunca la foto.
- **Cola local:** SQLite, con orden, `Idempotency-Key` y envío automático al recuperar la red. Cada usuario tiene su base.
- **Lecturas:** se muestra sin conexión lo último que se vio.

## Preparación

```powershell
flutter pub get
dart run tool/fetch_models.dart
```

## Ejecución en emulador o teléfono por USB

Los servicios corren en el equipo; `adb reverse` hace que `localhost` llegue a ellos:

```powershell
foreach ($p in 8080,8081,3100,8002) { adb reverse tcp:$p tcp:$p }
flutter run
```

## Pruebas

```powershell
flutter test
flutter test integration_test/app_offline_test.dart -d emulator-5554
```

La prueba de integración usa los modelos reales y los servicios reales.
