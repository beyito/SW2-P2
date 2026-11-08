import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { CounterComponent } from './counter.component';

const CLIENTES = [{ id: 'cli-002', fullName: 'Ana Pérez', email: 'ana@correo.test', phone: '700', loyaltyPoints: 0 }];
const CATALOGO = {
  getServices: [{ id: 'srv-01', name: 'Corte', durationMinutes: 45, price: 25 }],
  getStylists: [{ id: 'sty-101', name: 'Valentina' }],
};
const MANANA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const TURNO = `${MANANA}T10:00:00`;
const vista = (status: string, extra: object = {}) => ({
  sagaId: 'saga-1', status, appointmentId: 'apt-1', serviceName: 'Corte', amountToPayCents: 2500,
  failureReason: null, clientId: 'cli-002', paymentMethod: 'CASH', ...extra,
});

describe('CounterComponent', () => {
  let saga: Mock;
  let crm: Mock;
  let gestion: Mock;
  let estados: string[];

  beforeEach(async () => {
    estados = ['AWAITING_PAYMENT'];
    saga = vi.fn(async (path: string) => {
      if (path === '/counter/bookings') return vista('RESERVING_APPOINTMENT');
      if (path.endsWith('/pay') || path.endsWith('/void')) return vista('AWAITING_PAYMENT');
      return vista(estados.shift() ?? 'COMPLETED');
    });
    crm = vi.fn(async (query: string) => {
      if (query.includes('getInvoicesByClient')) {
        return { getInvoicesByClient: [{ id: 'inv-1', invoiceNumber: 17, appointmentId: 'apt-1', totalAmount: 25, paymentMethod: 'CASH' }] };
      }
      return { getClients: CLIENTES };
    });
    gestion = vi.fn(async (query: string) => {
      if (query.includes('getAvailableSlots')) return { getAvailableSlots: [{ start: TURNO, end: `${MANANA}T10:45:00` }] };
      return CATALOGO;
    });
    await TestBed.configureTestingModule({
      imports: [CounterComponent],
      providers: [{ provide: ApiService, useValue: { saga, crm, gestion, openReceipt: vi.fn() } }],
    }).compileComponents();
  });

  async function preparado() {
    const fixture = TestBed.createComponent(CounterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const counter = fixture.componentInstance;
    counter.clientId = 'cli-002';
    counter.serviceId = 'srv-01';
    counter.stylistId = 'sty-101';
    counter.date = MANANA;
    await counter.loadSlots();
    counter.selectedSlot.set(TURNO);
    fixture.detectChanges();
    return { fixture, counter };
  }

  it('aparta el turno del cliente elegido, con llave de idempotencia y forma de pago', async () => {
    const { counter } = await preparado();
    await counter.reserve();

    const [path, method, body, key] = saga.mock.calls[0];
    expect([path, method]).toEqual(['/counter/bookings', 'POST']);
    expect(body).toMatchObject({ clientId: 'cli-002', clientName: 'Ana Pérez', appointmentDate: TURNO, paymentMethod: 'CASH' });
    expect(key).toBeTruthy();
    expect(counter.step()).toBe('charge');
  });

  it('muestra el total y el cambio, y no deja confirmar si lo recibido no alcanza', async () => {
    const { fixture, counter } = await preparado();
    await counter.reserve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#counter-total').textContent).toContain('25.00');

    counter.received = 20;
    expect(counter.canPay()).toBe(false);
    counter.received = 30;
    expect(counter.change()).toBe(5);
    expect(counter.canPay()).toBe(true);
  });

  it('cobrar confirma la reserva y muestra la factura emitida', async () => {
    const { fixture, counter } = await preparado();
    await counter.reserve();
    await counter.pay();
    fixture.detectChanges();

    expect(saga.mock.calls.some(([path]) => path === '/bookings/saga-1')).toBe(true);
    expect(saga.mock.calls.some(([path, method]) => path === '/counter/bookings/saga-1/pay' && method === 'POST')).toBe(true);
    expect(counter.step()).toBe('done');
    expect(fixture.nativeElement.querySelector('#counter-invoice').textContent).toContain('17');
  });

  it('un reintento tras un fallo de red usa la misma llave', async () => {
    const { counter } = await preparado();
    saga.mockRejectedValueOnce(new Error('El servicio no está disponible.'));
    await counter.reserve();
    expect(counter.step()).toBe('form');
    await counter.reserve();
    expect(saga.mock.calls[0][3]).toBe(saga.mock.calls[1][3]);
  });

  it('un turno ya ocupado se informa sin cobrar, y la siguiente atención usa otra llave', async () => {
    const { fixture, counter } = await preparado();
    estados = ['COMPENSATED'];
    saga.mockImplementation(async (path: string) =>
      path === '/counter/bookings' ? vista('RESERVING_APPOINTMENT') : vista('COMPENSATED', { failureReason: 'SLOT_TAKEN' }));
    await counter.reserve();
    fixture.detectChanges();

    expect(counter.step()).toBe('failed');
    expect(fixture.nativeElement.querySelector('#counter-failed').textContent).toContain('ya no está disponible');
    expect(saga.mock.calls.some(([path]) => String(path).endsWith('/pay'))).toBe(false);

    const primera = saga.mock.calls[0][3];
    counter.backToForm();
    counter.selectedSlot.set(TURNO);
    await counter.reserve();
    const segunda = saga.mock.calls.filter(([path]) => path === '/counter/bookings')[1][3];
    expect(segunda).not.toBe(primera);
  });

  it('anular libera el turno y lo informa', async () => {
    const { counter } = await preparado();
    await counter.reserve();
    saga.mockImplementation(async (path: string) =>
      path.endsWith('/void') ? vista('AWAITING_PAYMENT') : vista('COMPENSATED', { failureReason: 'COUNTER_VOIDED' }));
    await counter.voidBooking();
    expect(counter.step()).toBe('failed');
    expect(counter.failure()).toContain('no se cobró nada');
  });

  it('no ofrece turnos que ya pasaron', async () => {
    gestion.mockImplementation(async (query: string) =>
      query.includes('getAvailableSlots') ? { getAvailableSlots: [{ start: '2020-01-01T10:00:00', end: '2020-01-01T10:45:00' }] } : CATALOGO);
    const { counter } = await preparado();
    expect(counter.slots()).toEqual([]);
  });

  it('registrar un cliente nuevo lo deja seleccionado', async () => {
    const { counter } = await preparado();
    crm.mockResolvedValueOnce({ registerClient: { id: 'cli-nuevo', fullName: 'Luis', email: 'l@correo.test', phone: '1', loyaltyPoints: 0 } });
    counter.newClient = { fullName: 'Luis', email: 'l@correo.test', phone: '1' };
    await counter.registerClient();
    expect(counter.clientId).toBe('cli-nuevo');
    expect(counter.clientName()).toBe('Luis');
  });
});
