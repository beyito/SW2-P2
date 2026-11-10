import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { isoDate, messageOf } from '../core/config';
import { Client, CounterBooking, Invoice, SalonService, TimeSlot } from '../core/models';

/** Estados en los que la reserva se anuló o se está anulando: ya no se cobra. */
const REVERTED = ['COMPENSATING_POINTS', 'COMPENSATING_STOCK', 'COMPENSATING_APPOINTMENT', 'COMPENSATED', 'FAILED'];
/** Estados posteriores al cobro: la cita ya quedó pagada. */
const PAID = ['CONFIRMING_APPOINTMENT', 'COMMITTING_STOCK', 'COMPLETED'];

const FAILURES: Record<string, string> = {
  SLOT_TAKEN: 'El turno ya no está disponible. Elija otro horario.',
  OUTSIDE_WORKING_HOURS: 'El horario está fuera de la jornada del estilista.',
  STOCK_INSUFFICIENT: 'No hay insumos suficientes para este servicio.',
  SERVICE_NOT_FOUND: 'El servicio ya no está disponible.',
  INVALID_DATE: 'La fecha del turno no es válida.',
  COUNTER_VOIDED: 'La atención se anuló: el turno quedó libre y no se cobró nada.',
  PAYMENT_TIMEOUT: 'Venció el plazo para cobrar: el turno quedó libre. Si recibió dinero, devuélvalo.',
};

const POLL_MS = 1000;
const MAX_POLLS = 30;

type Step = 'form' | 'reserving' | 'charge' | 'paying' | 'done' | 'failed';

const emptyClient = () => ({ fullName: '', email: '', phone: '' });

/**
 * Mostrador de recepción: un cliente que llega sin reserva elige turno y paga en el momento (CU-06, CU-10, CU-11).
 * El turno se aparta con la misma SAGA de las reservas en línea; el cobro lo confirma quien atiende.
 */
@Component({
  selector: 'app-counter',
  imports: [DecimalPipe, FormsModule],
  template: `
    <section class="card">
      <h2>Mostrador: cliente sin reserva</h2>
      @if (error()) { <p class="error" role="alert" id="counter-error">{{ error() }}</p> }

      @if (step() === 'form') {
        <h3>1. Cliente</h3>
        <div class="row">
          <label>Buscar <input id="counter-client-search" name="search" [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="Nombre o correo"></label>
          <label>Cliente
            <select id="counter-client" name="clientId" [(ngModel)]="clientId">
              <option value="">Seleccione...</option>
              @for (client of matchingClients(); track client.id) {
                <option [value]="client.id">{{ client.fullName }} · {{ client.email }}</option>
              }
            </select>
          </label>
          <button type="button" class="secondary" id="counter-new-client" (click)="registering = !registering">
            {{ registering ? 'Cancelar registro' : 'Cliente nuevo' }}
          </button>
        </div>
        @if (registering) {
          <form class="row" (ngSubmit)="registerClient()">
            <label>Nombre completo <input id="counter-client-name" class="wide" name="fullName" [(ngModel)]="newClient.fullName" required></label>
            <label>Correo <input id="counter-client-email" type="email" name="email" [(ngModel)]="newClient.email" required></label>
            <label>Teléfono <input id="counter-client-phone" name="phone" [(ngModel)]="newClient.phone" required></label>
            <button class="primary" type="submit" id="counter-client-save">Registrar cliente</button>
          </form>
        }

        <h3>2. Servicio y turno</h3>
        <div class="row">
          <label>Servicio
            <select id="counter-service" name="serviceId" [(ngModel)]="serviceId" (ngModelChange)="clearSlots()">
              <option value="">Seleccione...</option>
              @for (service of services(); track service.id) {
                <option [value]="service.id">{{ service.name }} · {{ service.durationMinutes }} min · {{ service.price | number: '1.2-2' }} USD</option>
              }
            </select>
          </label>
          <label>Estilista
            <select id="counter-stylist" name="stylistId" [(ngModel)]="stylistId" (ngModelChange)="clearSlots()">
              <option value="">Seleccione...</option>
              @for (stylist of stylists(); track stylist.id) {
                <option [value]="stylist.id">{{ stylist.name }}</option>
              }
            </select>
          </label>
          <label>Fecha <input id="counter-date" type="date" name="date" [(ngModel)]="date" (ngModelChange)="clearSlots()"></label>
          <button type="button" class="secondary" id="counter-slots" (click)="loadSlots()" [disabled]="!serviceId || !stylistId || !date">Ver turnos</button>
        </div>
        @if (slotsLoaded()) {
          <div class="row" id="counter-slot-list">
            @for (slot of slots(); track slot.start) {
              <button type="button" class="slot" [class.primary]="selectedSlot() === slot.start" [class.secondary]="selectedSlot() !== slot.start"
                      (click)="selectedSlot.set(slot.start)">{{ slot.start.slice(11, 16) }}</button>
            } @empty {
              <p class="muted">No quedan turnos libres ese día.</p>
            }
          </div>
        }

        <h3>3. Forma de pago</h3>
        <div class="row">
          <label><input type="radio" name="method" value="CASH" [(ngModel)]="paymentMethod" id="counter-cash"> Efectivo</label>
          <label><input type="radio" name="method" value="CARD_TERMINAL" [(ngModel)]="paymentMethod" id="counter-card"> Tarjeta en el terminal</label>
        </div>
        <div class="row">
          <button type="button" class="primary" id="counter-reserve" [disabled]="!canReserve()" (click)="reserve()">Apartar turno</button>
        </div>
      }

      @if (step() === 'reserving' || step() === 'paying') {
        <p class="muted" role="status" id="counter-progress">{{ step() === 'reserving' ? 'Apartando el turno y los insumos...' : 'Registrando el cobro y emitiendo la factura...' }}</p>
      }

      @if (step() === 'charge' && booking(); as b) {
        <div id="counter-charge">
          <p>Turno apartado para <strong>{{ clientName() }}</strong>: {{ b.serviceName }}, {{ selectedSlot().replace('T', ' ').slice(0, 16) }}.</p>
          <p class="total">Total a cobrar: <strong id="counter-total">{{ (b.amountToPayCents ?? 0) / 100 | number: '1.2-2' }} USD</strong>
            · {{ paymentMethod === 'CASH' ? 'efectivo' : 'tarjeta en el terminal' }}</p>
          @if (paymentMethod === 'CASH') {
            <div class="row">
              <label>Recibido <input id="counter-received" type="number" min="0" step="0.01" name="received" [(ngModel)]="received"></label>
              @if (change() !== null) { <span id="counter-change">Cambio: {{ change() | number: '1.2-2' }} USD</span> }
            </div>
          }
          <p class="muted">Cobre al cliente y confirme. Si se retira sin pagar, anule para liberar el turno.</p>
          <div class="row">
            <button type="button" class="primary" id="counter-pay" [disabled]="!canPay()" (click)="pay()">Confirmar cobro</button>
            <button type="button" class="danger" id="counter-void" (click)="voidBooking()">Anular</button>
          </div>
        </div>
      }

      @if (step() === 'done') {
        <div id="counter-done">
          <p class="success" role="status">Cobro registrado. La cita quedó confirmada.</p>
          @if (invoice(); as inv) {
            <p>Factura N.º <strong id="counter-invoice">{{ inv.invoiceNumber }}</strong> · {{ inv.totalAmount | number: '1.2-2' }} USD</p>
            <button type="button" class="secondary" id="counter-receipt" (click)="openReceipt(inv.id)">Ver comprobante</button>
          } @else {
            <p class="muted" id="counter-invoice-pending">La factura se está emitiendo; también la verá en el historial del cliente.</p>
          }
          <div class="row"><button type="button" class="primary" id="counter-next" (click)="reset()">Atender a otro cliente</button></div>
        </div>
      }

      @if (step() === 'failed') {
        <div id="counter-failed">
          <p class="error" role="alert">{{ failure() }}</p>
          <div class="row"><button type="button" class="primary" id="counter-retry" (click)="backToForm()">Volver</button></div>
        </div>
      }
    </section>
  `,
})
export class CounterComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly clients = signal<Client[]>([]);
  readonly services = signal<SalonService[]>([]);
  readonly stylists = signal<{ id: string; name: string }[]>([]);
  readonly slots = signal<TimeSlot[]>([]);
  readonly slotsLoaded = signal(false);
  readonly selectedSlot = signal('');
  readonly step = signal<Step>('form');
  readonly booking = signal<CounterBooking | null>(null);
  readonly invoice = signal<Invoice | null>(null);
  readonly failure = signal('');
  readonly error = signal('');
  readonly search = signal('');
  clientId = '';
  serviceId = '';
  stylistId = '';
  date = isoDate(new Date());
  paymentMethod: 'CASH' | 'CARD_TERMINAL' = 'CASH';
  received: number | null = null;
  registering = false;
  newClient = emptyClient();
  /** Se reutiliza en cada reintento de la misma atención: el turno nunca se aparta dos veces (RNF-04). */
  private idempotencyKey = crypto.randomUUID();
  private destroyed = false;

  readonly matchingClients = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.clients().filter((client) => !term || `${client.fullName} ${client.email}`.toLowerCase().includes(term));
  });

  ngOnInit(): void {
    void this.loadCatalog();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  private async loadCatalog(): Promise<void> {
    try {
      const [{ getClients }, catalog] = await Promise.all([
        this.api.crm<{ getClients: Client[] }>('{ getClients { id fullName email phone loyaltyPoints } }'),
        this.api.gestion<{ getServices: SalonService[]; getStylists: { id: string; name: string }[] }>(
          '{ getServices { id name durationMinutes price } getStylists { id name } }',
        ),
      ]);
      this.clients.set(getClients);
      this.services.set(catalog.getServices);
      this.stylists.set(catalog.getStylists);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  clientName(): string {
    return this.clients().find((client) => client.id === this.clientId)?.fullName ?? '';
  }

  clearSlots(): void {
    this.slots.set([]);
    this.slotsLoaded.set(false);
    this.selectedSlot.set('');
  }

  async loadSlots(): Promise<void> {
    this.error.set('');
    this.clearSlots();
    try {
      const { getAvailableSlots } = await this.api.gestion<{ getAvailableSlots: TimeSlot[] }>(
        'query ($s: String!, $v: String!, $d: String!) { getAvailableSlots(stylistId: $s, serviceId: $v, date: $d) { start end } }',
        { s: this.stylistId, v: this.serviceId, d: this.date },
      );
      // Un cliente presente no puede tomar un turno que ya pasó
      const now = new Date();
      this.slots.set(getAvailableSlots.filter((slot) => new Date(slot.start) > now));
      this.slotsLoaded.set(true);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  async registerClient(): Promise<void> {
    this.error.set('');
    try {
      const { registerClient } = await this.api.crm<{ registerClient: Client }>(
        'mutation ($i: RegisterClientInput!) { registerClient(input: $i) { id fullName email phone loyaltyPoints } }',
        { i: this.newClient },
      );
      this.clients.update((list) => [...list, registerClient]);
      this.clientId = registerClient.id;
      this.newClient = emptyClient();
      this.registering = false;
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  canReserve(): boolean {
    return Boolean(this.clientId && this.serviceId && this.stylistId && this.selectedSlot());
  }

  /** Inicia la SAGA del mostrador y espera a que el turno y los insumos queden apartados. */
  async reserve(): Promise<void> {
    const client = this.clients().find((candidate) => candidate.id === this.clientId);
    if (!client || !this.canReserve()) return;
    this.error.set('');
    this.step.set('reserving');
    try {
      const started = await this.api.startCounterBooking({
        clientId: client.id,
        clientName: client.fullName,
        clientEmail: client.email || null,
        serviceId: this.serviceId,
        stylistId: this.stylistId,
        appointmentDate: this.selectedSlot(),
        paymentMethod: this.paymentMethod,
      }, this.idempotencyKey);
      const ready = await this.waitFor(started.sagaId, (b) => b.status === 'AWAITING_PAYMENT' || PAID.includes(b.status));
      if (!ready) return;
      this.booking.set(ready);
      if (PAID.includes(ready.status)) {
        await this.finish(ready);
      } else {
        this.step.set('charge');
      }
    } catch (error) {
      this.error.set(messageOf(error));
      this.step.set('form');
    }
  }

  change(): number | null {
    const total = (this.booking()?.amountToPayCents ?? 0) / 100;
    if (this.received == null || this.received < total) return null;
    return Math.round((this.received - total) * 100) / 100;
  }

  canPay(): boolean {
    if (this.paymentMethod !== 'CASH') return true;
    return this.received == null || this.change() !== null;
  }

  /** Paso pivote: confirma que el dinero se recibió. Repetirlo no cobra dos veces. */
  async pay(): Promise<void> {
    const booking = this.booking();
    if (!booking) return;
    this.error.set('');
    this.step.set('paying');
    try {
      await this.api.payCounterBooking(booking.sagaId);
      const paid = await this.waitFor(booking.sagaId, (b) => b.status === 'COMPLETED');
      if (paid) await this.finish(paid);
    } catch (error) {
      this.error.set(messageOf(error));
      this.step.set('charge');
    }
  }

  async voidBooking(): Promise<void> {
    const booking = this.booking();
    if (!booking) return;
    this.error.set('');
    try {
      await this.api.voidCounterBooking(booking.sagaId);
      // Termina cuando la SAGA empieza a revertir: waitFor lo informa con el motivo de la anulación
      await this.waitFor(booking.sagaId, () => false);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  /**
   * Consulta la SAGA hasta que cumple la condición. Si se anula o vence, lo informa y devuelve null.
   */
  private async waitFor(sagaId: string, done: (booking: CounterBooking) => boolean): Promise<CounterBooking | null> {
    for (let attempt = 0; attempt < MAX_POLLS && !this.destroyed; attempt += 1) {
      const current = await this.api.counterBooking(sagaId);
      if (done(current)) return current;
      if (REVERTED.includes(current.status)) {
        this.fail(current.failureReason);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (!this.destroyed) {
      this.error.set('El servicio tarda en responder. Revise la agenda antes de volver a intentar.');
      this.step.set(this.booking() ? 'charge' : 'form');
    }
    return null;
  }

  private fail(reason: string | null): void {
    this.failure.set(FAILURES[reason ?? ''] ?? 'No se pudo completar la atención. El turno quedó libre.');
    this.step.set('failed');
    // Una atención anulada no puede reutilizarse: la siguiente necesita su propia llave
    this.idempotencyKey = crypto.randomUUID();
  }

  /** La factura la emite el CRM al recibir el evento de pago: se espera unos segundos. */
  private async finish(booking: CounterBooking): Promise<void> {
    this.booking.set(booking);
    this.step.set('done');
    for (let attempt = 0; attempt < 10 && !this.destroyed && !this.invoice(); attempt += 1) {
      try {
        const { getInvoicesByClient } = await this.api.crm<{ getInvoicesByClient: Invoice[] }>(
          'query ($c: String!) { getInvoicesByClient(clientId: $c) { id invoiceNumber appointmentId totalAmount paymentMethod } }',
          { c: booking.clientId },
        );
        const found = getInvoicesByClient.find((invoice) => invoice.appointmentId === booking.appointmentId);
        if (found) {
          this.invoice.set(found);
          return;
        }
      } catch {
        // Se reintenta: la factura puede tardar en emitirse
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async openReceipt(invoiceId: string): Promise<void> {
    try {
      await this.api.openReceipt(invoiceId);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  backToForm(): void {
    this.booking.set(null);
    this.clearSlots();
    this.step.set('form');
  }

  reset(): void {
    this.booking.set(null);
    this.invoice.set(null);
    this.clientId = '';
    this.search.set('');
    this.received = null;
    this.idempotencyKey = crypto.randomUUID();
    this.clearSlots();
    this.step.set('form');
    void this.loadCatalog();
  }
}
