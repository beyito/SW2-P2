import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { isoDate, messageOf } from '../core/config';
import { Client, PanelAppointment } from '../core/models';

const ATTENDABLE = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'];

/** Consultas literales: la prueba de contratos las valida contra el esquema real. */
const ACTIONS = {
  checkIn: 'mutation ($id: ID!) { checkInAppointment(id: $id) { id } }',
  noShow: 'mutation ($id: ID!) { markNoShow(id: $id) { id } }',
  complete: 'mutation ($id: ID!) { completeAppointment(id: $id) { id } }',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Pendiente de pago',
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  RESCHEDULED: 'Reprogramada',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};

/**
 * Agenda del salón sobre el Read Model (CU-05). La recepción registra llegadas y ausencias;
 * estilistas y administración registran las citas atendidas.
 */
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
                <td>
                  <span class="badge" [class.good]="row.status === 'COMPLETED'" [class.bad]="row.status === 'CANCELLED' || row.status === 'NO_SHOW'">{{ statusLabel(row.status) }}</span>
                  @if (row.checkedInAt && isPending(row)) {
                    <span class="badge good arrived">En el salón desde {{ row.checkedInAt | date: 'HH:mm' }}</span>
                  }
                </td>
                <td class="row">
                  @if (canCheckIn(row)) {
                    <button type="button" class="primary btn-check-in" (click)="act(row, 'checkIn')">Llegó</button>
                  }
                  @if (canMarkNoShow(row)) {
                    <button type="button" class="danger btn-no-show" (click)="act(row, 'noShow')">No asistió</button>
                  }
                  @if (canAttend(row)) {
                    <button type="button" class="secondary btn-complete" (click)="act(row, 'complete')">Marcar atendida</button>
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
  private readonly auth = inject(AuthService);
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
        'query ($from: String!, $to: String!) { getPanelAgenda(from: $from, to: $to) { id clientId stylistName serviceName appointmentDate durationMinutes totalPrice status checkedInAt } }',
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

  isPending(row: PanelAppointment): boolean {
    return ATTENDABLE.includes(row.status);
  }

  /** Atender lo registran estilistas y administración, no la recepción. */
  canAttend(row: PanelAppointment): boolean {
    const attends = this.auth.roles().some((role) => role === 'ADMIN' || role === 'STYLIST');
    return attends && this.isPending(row) && new Date(row.appointmentDate) <= new Date();
  }

  /** La llegada se registra el día de la cita. */
  canCheckIn(row: PanelAppointment): boolean {
    return this.auth.isDesk() && this.isPending(row) && !row.checkedInAt
      && row.appointmentDate.slice(0, 10) === isoDate(new Date());
  }

  /** Ausente: ya pasó la hora de inicio y no se registró su llegada. */
  canMarkNoShow(row: PanelAppointment): boolean {
    return this.auth.isDesk() && this.isPending(row) && !row.checkedInAt && new Date(row.appointmentDate) <= new Date();
  }

  async act(row: PanelAppointment, action: keyof typeof ACTIONS): Promise<void> {
    this.error.set('');
    try {
      await this.api.gestion(ACTIONS[action], { id: row.id });
      await this.load();
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }
}
