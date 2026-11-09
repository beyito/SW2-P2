import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from './core/auth.service';
import { AgendaComponent } from './features/agenda.component';
import { AgentComponent } from './features/agent.component';
import { ClientsComponent } from './features/clients.component';
import { CounterComponent } from './features/counter.component';
import { InventoryComponent } from './features/inventory.component';
import { ModerationComponent } from './features/moderation.component';
import { PanelComponent } from './features/panel.component';
import { ReportsComponent } from './features/reports.component';
import { StylistsComponent } from './features/stylists.component';

type Tab = 'panel' | 'agenda' | 'counter' | 'inventory' | 'stylists' | 'clients' | 'moderation' | 'agent' | 'reports';
type Role = 'ADMIN' | 'STYLIST' | 'RECEPTIONIST';

/** Cada pestaña indica qué roles la ven. Ocultarla es comodidad: quien autoriza es cada servicio. */
const TABS: { id: Tab; label: string; roles: Role[] }[] = [
  { id: 'panel', label: 'Panel', roles: ['ADMIN', 'STYLIST'] },
  { id: 'agenda', label: 'Agenda', roles: ['ADMIN', 'STYLIST', 'RECEPTIONIST'] },
  { id: 'counter', label: 'Mostrador', roles: ['ADMIN', 'RECEPTIONIST'] },
  { id: 'inventory', label: 'Inventario', roles: ['ADMIN', 'STYLIST'] },
  { id: 'stylists', label: 'Estilistas', roles: ['ADMIN', 'STYLIST', 'RECEPTIONIST'] },
  { id: 'clients', label: 'Clientes', roles: ['ADMIN', 'STYLIST', 'RECEPTIONIST'] },
  { id: 'moderation', label: 'Moderación', roles: ['ADMIN', 'STYLIST'] },
  { id: 'agent', label: 'Asistentes', roles: ['ADMIN', 'STYLIST'] },
  // Los reportes traen datos de clientes y facturación: solo la administración
  { id: 'reports', label: 'Reportes', roles: ['ADMIN'] },
];

@Component({
  selector: 'app-root',
  imports: [
    AgendaComponent, AgentComponent, ClientsComponent, CounterComponent, InventoryComponent,
    ModerationComponent, PanelComponent, ReportsComponent, StylistsComponent,
  ],
  template: `
    <div class="page">
      @if (!auth.token()) {
        <div class="card" id="waiting-session">Esperando la sesión de la plataforma...</div>
      } @else if (!isStaff()) {
        <div class="card error" role="alert">Este módulo es solo para el personal del salón.</div>
      } @else {
        <nav class="tabs">
          @for (tab of tabs(); track tab.id) {
            <button type="button" [id]="'erp-tab-' + tab.id" [class.active]="active() === tab.id" (click)="chosen.set(tab.id)">
              {{ tab.label }}
            </button>
          }
        </nav>
        @switch (active()) {
          @case ('panel') { <app-panel /> }
          @case ('agenda') { <app-agenda /> }
          @case ('counter') { <app-counter /> }
          @case ('inventory') { <app-inventory /> }
          @case ('stylists') { <app-stylists /> }
          @case ('clients') { <app-clients /> }
          @case ('moderation') { <app-moderation /> }
          @case ('agent') { <app-agent /> }
          @case ('reports') { <app-reports /> }
        }
      }
    </div>
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly tabs = computed(() => TABS.filter((tab) => tab.roles.some((role) => this.auth.roles().includes(role))));
  readonly chosen = signal<Tab | null>(null);
  /** La pestaña elegida si el rol la ve; si no, la primera disponible (la recepción empieza en la Agenda). */
  readonly active = computed<Tab | undefined>(() => {
    const visible = this.tabs();
    return visible.find((tab) => tab.id === this.chosen())?.id ?? visible[0]?.id;
  });
  readonly isStaff = computed(() => this.tabs().length > 0);
}
