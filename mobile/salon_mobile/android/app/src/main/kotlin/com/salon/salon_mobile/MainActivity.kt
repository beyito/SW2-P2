package com.salon.salon_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity

// El formulario de pago de Stripe se muestra como fragmento: requiere FlutterFragmentActivity
class MainActivity : FlutterFragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Canal de las notificaciones push con importancia alta: así Android las muestra flotando
        // arriba de la pantalla y no solo en la barra. El CRM envía cada push a este canal.
        val canal = NotificationChannel(CANAL_AVISOS, "Avisos del salón", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Pagos, reembolsos, recordatorios y avisos de tu cuenta"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    companion object {
        const val CANAL_AVISOS = "avisos"
    }
}
