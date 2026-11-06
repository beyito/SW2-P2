import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  minStock: number;
  supplier: string;
  unit: string;
}

export interface Appointment {
  id: string;
  clientName: string;
  service: string;
  stylist: string;
  time: string;
  status: string;
  price: number;
}

@Injectable({
  providedIn: 'root'
})
export class GestionApiService {
  private initialInventory: InventoryItem[] = [
    { id: 'inv-1', name: 'Tinte Rubio Cenizo 8.1', category: 'COLORACION', currentStock: 3, minStock: 5, supplier: 'L’Oréal Professionnel', unit: 'tubos' },
    { id: 'inv-2', name: 'Keratina Hidrolizada', category: 'TRATAMIENTOS', currentStock: 8, minStock: 4, supplier: 'Inoar Professional', unit: 'botellas 1L' },
    { id: 'inv-3', name: 'Polvo Decolorante Plex', category: 'DECOLORACION', currentStock: 1, minStock: 3, supplier: 'Schwarzkopf', unit: 'latas 500g' },
    { id: 'inv-4', name: 'Sérum Argán Termo-Protector', category: 'CUIDADO', currentStock: 14, minStock: 6, supplier: 'Moroccanoil', unit: 'frascos' }
  ];

  private initialAppointments: Appointment[] = [
    { id: 'apt-101', clientName: 'Camila Fernandez', service: 'Balayage Deluxe & Matizado', stylist: 'Valentina Rossi', time: '10:00 - 12:30', status: 'CONFIRMED', price: 120 },
    { id: 'apt-102', clientName: 'Andrea Solis', service: 'Keratina Brasileña', stylist: 'Sofía Morales', time: '14:00 - 16:00', status: 'CONFIRMED', price: 95 },
    { id: 'apt-103', clientName: 'Lucía Méndez', service: 'Corte Visagista & Peinado', stylist: 'Carlos Mendoza', time: '11:00 - 12:00', status: 'COMPLETED', price: 45 }
  ];

  getInventory(): Observable<InventoryItem[]> {
    return of(this.initialInventory);
  }

  getAppointments(): Observable<Appointment[]> {
    return of(this.initialAppointments);
  }

  // GraphQL query simulation for ms-gestion (RNF-01 < 200ms)
  executeGraphQLQuery(query: string): Observable<any> {
    return of({
      data: {
        appointments: this.initialAppointments,
        inventorySummary: { totalCount: this.initialInventory.length, criticalAlerts: 2 }
      }
    });
  }

  // MCP JSON-RPC 2.0 Agent tool query (RNF-02, CU-17, CU-18)
  queryMcpAgent(prompt: string): Observable<string> {
    const lower = prompt.toLowerCase();
    if (lower.includes('stock') || lower.includes('crítico')) {
      return of(`📊 **Reporte de Inventario Crítico (Herramienta: consultar_stock_critico):**\n• Tinte Rubio Cenizo 8.1: 3 tubos (Mínimo: 5)\n• Polvo Decolorante Plex: 1 lata (Mínimo: 3)\n💡 Se ha disparado alerta omnicanal a n8n.`);
    }
    if (lower.includes('disponib') || lower.includes('agenda')) {
      return of(`📅 **Disponibilidad de Estilistas (Herramienta: consultar_disponibilidad_estilista):**\n• Valentina Rossi: 2 turnos libres mañana.\n• Carlos Mendoza: Agenda al 85% de capacidad.`);
    }
    return of(`🤖 **Respuesta Generativa MCP:**\nConsulta procesada: "${prompt}". Los servicios operan con latencia < 20ms.`);
  }
}
