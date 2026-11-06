import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from './core/auth.service';
import { AgendaComponent } from './features/agenda.component';
import { AgentComponent } from './features/agent.component';
import { ClientsComponent } from './features/clients.component';
import { InventoryComponent } from './features/inventory.component';
import { ModerationComponent } from './features/moderation.component';
import { PanelComponent } from './features/panel.component';
import { StylistsComponent } from './features/stylists.component';

type Tab = 'panel' | 'agenda' | 'inventory' | 'stylists' | 'clients' | 'moderation' | 'agent';

const TABS: { id: Tab; label: string }[] = [
  { id: 'panel', label: 'Panel' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'stylists', label: 'Estilistas' },
  { id: 'clients', label: 'Clientes' },
  { id: 'moderation', label: 'Moderación' },
  { id: 'agent', label: 'Agente MCP' },
];

@Component({
  selector: 'app-root',
  imports: [
    AgendaComponent, AgentComponent, ClientsComponent, InventoryComponent,
    ModerationComponent, PanelComponent, StylistsComponent,
  ],
  template: `
    <div class="page">
      @if (!auth.token()) {
        <div class="card" id="waiting-session">Esperando la sesión de la plataforma...</div>
      } @else if (!isStaff()) {
        <div class="card error" role="alert">Este módulo es solo para el personal del salón.</div>
      } @else {
        <nav class="tabs">
          @for (tab of tabs; track tab.id) {
            <button type="button" [id]="'erp-tab-' + tab.id" [class.active]="active() === tab.id" (click)="active.set(tab.id)">
              {{ tab.label }}
            </button>
          }
        </nav>
        @switch (active()) {
          @case ('panel') { <app-panel /> }
          @case ('agenda') { <app-agenda /> }
          @case ('inventory') { <app-inventory /> }
          @case ('stylists') { <app-stylists /> }
          @case ('clients') { <app-clients /> }
          @case ('moderation') { <app-moderation /> }
          @case ('agent') { <app-agent /> }
        }
      }
    </div>
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly tabs = TABS;
  readonly active = signal<Tab>('panel');
  readonly isStaff = computed(() => this.auth.roles().some((role) => role === 'ADMIN' || role === 'STYLIST'));
}
