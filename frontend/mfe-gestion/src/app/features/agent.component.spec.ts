import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { AgentComponent } from './agent.component';

const RESPUESTA = {
  content: [{ type: 'text', text: '' }],
  structuredContent: {
    generatedReport: 'Te propongo reponer.',
    engine: 'Modelo',
    toolsUsed: ['proponer_reposicion'],
    pendingActions: [{ actionId: 'a-1', summary: 'Sumar 5 unidades a Keratina: de 3 a 8.', reason: 'Falta' }],
  },
};

describe('AgentComponent', () => {
  let mcp: Mock;

  beforeEach(async () => {
    mcp = vi.fn(async (method: string, params?: { name: string }) => {
      if (method === 'tools/list') return { tools: [{ name: 'preguntar_al_agente' }] };
      if (params?.name === 'preguntar_al_agente') return RESPUESTA;
      return { content: [{ type: 'text', text: '' }], structuredContent: {} };
    });
    await TestBed.configureTestingModule({
      imports: [AgentComponent],
      providers: [{ provide: ApiService, useValue: { mcp, transcribe: vi.fn() } }],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(AgentComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function preguntar(fixture: Awaited<ReturnType<typeof crear>>) {
    fixture.componentInstance.prompt = 'repón keratina';
    fixture.componentInstance.askReport();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const llamadas = (nombre: string) => mcp.mock.calls.filter(([, params]) => params?.name === nombre);
  const elemento = (fixture: Awaited<ReturnType<typeof crear>>): HTMLElement => fixture.nativeElement;

  it('ofrece los tres agentes y empieza por el de operación', async () => {
    const fixture = await crear();
    expect(elemento(fixture).querySelectorAll('[id^="agent-select-"]').length).toBe(3);
    expect(fixture.componentInstance.selected().id).toBe('operacion');
  });

  it('pregunta al agente elegido', async () => {
    const fixture = await crear();
    (elemento(fixture).querySelector('#agent-select-inventario') as HTMLElement).click();
    await preguntar(fixture);
    expect(llamadas('preguntar_al_agente')[0][1].arguments).toEqual({ prompt: 'repón keratina', agente: 'inventario' });
  });

  it('muestra la propuesta sin ejecutarla', async () => {
    const fixture = await crear();
    await preguntar(fixture);
    expect(elemento(fixture).querySelector('.action-summary')?.textContent).toContain('Sumar 5 unidades');
    expect(elemento(fixture).querySelector('.btn-action-confirm')).not.toBeNull();
    expect(llamadas('confirmar_accion')).toEqual([]);
  });

  it('confirmar envía la decisión de la persona y quita los botones', async () => {
    const fixture = await crear();
    await preguntar(fixture);
    (elemento(fixture).querySelector('.btn-action-confirm') as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(llamadas('confirmar_accion')[0][1].arguments).toEqual({ actionId: 'a-1' });
    expect(elemento(fixture).querySelector('.action-done')?.textContent).toContain('Confirmado');
    expect(elemento(fixture).querySelector('.btn-action-confirm')).toBeNull();
  });

  it('rechazar no confirma nada', async () => {
    const fixture = await crear();
    await preguntar(fixture);
    (elemento(fixture).querySelector('.btn-action-reject') as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(llamadas('confirmar_accion')).toEqual([]);
    expect(llamadas('rechazar_accion').length).toBe(1);
    expect(elemento(fixture).querySelector('.action-done')?.textContent).toContain('Rechazado');
  });

  it('si la acción falla lo dice y no la da por aplicada', async () => {
    const fixture = await crear();
    await preguntar(fixture);
    mcp.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'Ese turno ya no está libre.' }] });
    (elemento(fixture).querySelector('.btn-action-confirm') as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(elemento(fixture).querySelector('.action-error')?.textContent).toContain('ya no está libre');
    expect(elemento(fixture).querySelector('.action-done')?.textContent).not.toContain('Confirmado');
  });
});
