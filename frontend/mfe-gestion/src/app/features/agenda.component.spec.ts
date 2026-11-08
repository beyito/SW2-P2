import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { isoDate } from '../core/config';
import { PanelAppointment } from '../core/models';
import { AgendaComponent } from './agenda.component';
import { computed, signal } from '@angular/core';

const HOY = isoDate(new Date());
const cita = (extra: Partial<PanelAppointment>): PanelAppointment => ({
  id: 'apt-1', clientId: 'cli-001', stylistName: 'Valentina', serviceName: 'Corte', appointmentDate: `${HOY}T00:01:00`,
  durationMinutes: 45, totalPrice: 25, status: 'CONFIRMED', checkedInAt: null, ...extra,
});

/** Sesión falsa con los roles indicados. */
function sesion(roles: string[]) {
  const value = signal(roles);
  return {
    roles: value,
    isAdmin: computed(() => value().includes('ADMIN')),
    isReceptionist: computed(() => value().includes('RECEPTIONIST')),
    isDesk: computed(() => value().includes('ADMIN') || value().includes('RECEPTIONIST')),
  };
}

describe('AgendaComponent', () => {
  let gestion: Mock;

  async function crear(roles: string[], filas: PanelAppointment[]) {
    gestion = vi.fn(async (query: string) => (query.includes('getPanelAgenda') ? { getPanelAgenda: filas } : {}));
    await TestBed.configureTestingModule({
      imports: [AgendaComponent],
      providers: [
        { provide: ApiService, useValue: { gestion, crm: vi.fn(async () => ({ getClients: [] })) } },
        { provide: AuthService, useValue: sesion(roles) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AgendaComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('la recepción registra llegada y ausencia, pero no marca atendida', async () => {
    const fixture = await crear(['RECEPTIONIST'], [cita({})]);
    const html: HTMLElement = fixture.nativeElement;
    expect(html.querySelector('.btn-check-in')).not.toBeNull();
    expect(html.querySelector('.btn-no-show')).not.toBeNull();
    expect(html.querySelector('.btn-complete')).toBeNull();
  });

  it('un estilista marca atendida, pero no registra llegadas', async () => {
    const fixture = await crear(['STYLIST'], [cita({})]);
    const html: HTMLElement = fixture.nativeElement;
    expect(html.querySelector('.btn-check-in')).toBeNull();
    expect(html.querySelector('.btn-complete')).not.toBeNull();
  });

  it('con el cliente en el salón ya no se ofrece llegada ni ausencia', async () => {
    const fixture = await crear(['RECEPTIONIST'], [cita({ checkedInAt: `${HOY}T00:00:30` })]);
    const html: HTMLElement = fixture.nativeElement;
    expect(html.querySelector('.arrived')?.textContent).toContain('En el salón');
    expect(html.querySelector('.btn-check-in')).toBeNull();
    expect(html.querySelector('.btn-no-show')).toBeNull();
  });

  it('una ausencia se muestra como "No asistió" y sin acciones', async () => {
    const fixture = await crear(['RECEPTIONIST'], [cita({ status: 'NO_SHOW' })]);
    const html: HTMLElement = fixture.nativeElement;
    expect(html.querySelector('.agenda-row')?.textContent).toContain('No asistió');
    expect(html.querySelector('button.btn-check-in, button.btn-no-show, button.btn-complete')).toBeNull();
  });

  it('pulsar "Llegó" envía la mutación y recarga la agenda', async () => {
    const fixture = await crear(['RECEPTIONIST'], [cita({})]);
    (fixture.nativeElement.querySelector('.btn-check-in') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(gestion.mock.calls.some(([query]) => String(query).includes('checkInAppointment'))).toBe(true);
    expect(gestion.mock.calls.filter(([query]) => String(query).includes('getPanelAgenda')).length).toBe(2);
  });
});
