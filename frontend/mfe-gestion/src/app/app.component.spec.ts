import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { ApiService } from './core/api.service';
import { AuthService } from './core/auth.service';

/** Sesión falsa con los roles indicados. */
function sesion(roles: string[]) {
  const value = signal(roles);
  return {
    token: signal('a.e30.c'),
    roles: value,
    userId: signal('usuario'),
    isAdmin: computed(() => value().includes('ADMIN')),
    isReceptionist: computed(() => value().includes('RECEPTIONIST')),
    isDesk: computed(() => value().includes('ADMIN') || value().includes('RECEPTIONIST')),
  };
}

const pestanas = (html: HTMLElement) => Array.from(html.querySelectorAll('nav.tabs button')).map((button) => button.id);

describe('AppComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  async function crear(roles: string[]) {
    const vacio = vi.fn(async () => ({ getPanelAgenda: [], getClients: [], getServices: [], getStylists: [], getPanelSummary: null }));
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AuthService, useValue: sesion(roles) },
        { provide: ApiService, useValue: { gestion: vacio, crm: vacio, asesoria: vacio, mcp: vacio, saga: vacio } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('la recepción ve agenda, mostrador, estilistas y clientes, y empieza en la agenda', async () => {
    const fixture = await crear(['RECEPTIONIST']);
    expect(pestanas(fixture.nativeElement)).toEqual(['erp-tab-agenda', 'erp-tab-counter', 'erp-tab-stylists', 'erp-tab-clients']);
    expect(fixture.componentInstance.active()).toBe('agenda');
  });

  it('un estilista no ve el mostrador', async () => {
    const fixture = await crear(['STYLIST']);
    expect(pestanas(fixture.nativeElement)).not.toContain('erp-tab-counter');
  });

  it('la administración ve todas las pestañas', async () => {
    const fixture = await crear(['ADMIN']);
    expect(pestanas(fixture.nativeElement)).toHaveLength(8);
  });

  it('un cliente no entra al módulo', async () => {
    const fixture = await crear(['CLIENT']);
    expect(fixture.nativeElement.textContent).toContain('solo para el personal');
  });
});
