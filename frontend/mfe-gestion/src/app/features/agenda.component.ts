import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { isoDate, messageOf } from '../core/config';
import { Client, PanelAppointment } from '../core/models';

const ATTENDABLE = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'];

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Pendiente de pago',
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  RESCHEDULED: 'Reprogramada',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
};

/** Agenda del salón sobre el Read Model; el personal registra las citas atendidas (CU-05). */
@Component({
  selector: 'app-agenda',
  imports: [DatePipe, FormsModule],
  template: `
    <section class="card">
      <h2>Agenda</h2>
      <form class="row" (ngSubmit)="load()">
        <label>Desde <input id="agenda-from" type="date" name="from" [(ngModel)]="from" required></label>
        <label>Hasta <input id="agenda-to" type="date" name="to" [(ngModel)]="to" required></label>
        <button class="primary" type="submit" id="agenda-search">Buscar</button>
      </form>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Estilista</th><th>Servicio</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr class="agenda-row">
                <td>{{ row.appointmentDate | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ clientName(row.clientId) }}</td>
                <td>{{ row.stylistName }}</td>
                <td>{{ row.serviceName }}</td>
                <td><span class="badge" [class.good]="row.status === 'COMPLETED'" [class.bad]="row.status === 'CANCELLED'">{{ statusLabel(row.status) }}</span></td>
                <td>
                  @if (canAttend(row)) {
                    <button type="button" class="secondary" (click)="complete(row)">Marcar atendida</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">No hay citas en este periodo.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AgendaComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly rows = signal<PanelAppointment[]>([]);
  readonly clients = signal<Map<string, string>>(new Map());
  readonly error = signal('');
  from = isoDate(new Date());
  to = isoDate(new Date());

  ngOnInit(): void {
    void this.load();
    this.api
      .crm<{ getClients: Client[] }>('{ getClients { id fullName } }')
      .then(({ getClients }) => this.clients.set(new Map(getClients.map((client) => [client.id, client.fullName]))))
      .catch((error) => this.error.set(messageOf(error)));
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const { getPanelAgenda } = await this.api.gestion<{ getPanelAgenda: PanelAppointment[] }>(
        'query ($from: String!, $to: String!) { getPanelAgenda(from: $from, to: $to) { id clientId stylistName serviceName appointmentDate durationMinutes totalPrice status } }',
        { from: this.from, to: this.to },
      );
      this.rows.set(getPanelAgenda);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  clientName(id: string): string {
    return this.clients().get(id) ?? id;
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  canAttend(row: PanelAppointment): boolean {
    return ATTENDABLE.includes(row.status) && new Date(row.appointmentDate) <= new Date();
  }

  async complete(row: PanelAppointment): Promise<void> {
    this.error.set('');
    try {
      await this.api.gestion('mutation ($id: ID!) { completeAppointment(id: $id) { id } }', { id: row.id });
      await this.load();
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }
}
