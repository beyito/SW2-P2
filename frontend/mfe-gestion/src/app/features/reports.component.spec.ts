import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { ReportsComponent } from './reports.component';

const CATALOGO = {
  formatos: ['excel', 'pdf'],
  entidades: [
    {
      clave: 'facturas', titulo: 'Facturas', filtraPorFecha: true,
      columnas: [
        { clave: 'fecha', etiqueta: 'Fecha', tipo: 'texto' },
        { clave: 'servicio', etiqueta: 'Servicio', tipo: 'texto' },
        { clave: 'total', etiqueta: 'Total', tipo: 'dinero' },
      ],
      filtros: [{ clave: 'estado', modo: 'igual', valores: ['Emitida', 'Reembolsada'] }, { clave: 'cliente', modo: 'contiene' }],
    },
    { clave: 'inventario', titulo: 'Inventario', filtraPorFecha: false, columnas: [{ clave: 'insumo', etiqueta: 'Insumo', tipo: 'texto' }], filtros: [] },
  ],
};

const REPORTE = {
  titulo: 'Reporte de facturas', formato: 'pdf', filtrosAplicados: ['estado: Emitida'], totalFilas: 1, truncado: false,
  columnas: [{ clave: 'servicio', etiqueta: 'Servicio', tipo: 'texto' }, { clave: 'total', etiqueta: 'Total', tipo: 'dinero' }],
  totales: { total: 120 },
  vistaPrevia: [{ servicio: 'Balayage', total: 120 }],
  archivo: { nombre: 'reporte_de_facturas.pdf', tipoMime: 'application/pdf', bytes: 2048, base64: btoa('%PDF-1.3') },
};

const ok = (structuredContent: object) => ({ content: [{ type: 'text', text: '' }], structuredContent });

describe('ReportsComponent', () => {
  let mcp: Mock;

  beforeEach(async () => {
    mcp = vi.fn(async (_method: string, params: { name: string }) => {
      if (params.name === 'catalogo_reportes') return ok(CATALOGO);
      if (params.name === 'generar_reporte') return ok(REPORTE);
      if (params.name === 'preguntar_al_agente') return ok({ generatedReport: 'Listo: 1 factura.', reports: [REPORTE] });
      return { isError: true, content: [{ type: 'text', text: 'No existe' }] };
    });
    await TestBed.configureTestingModule({
      imports: [ReportsComponent],
      providers: [{ provide: ApiService, useValue: { mcp, transcribe: vi.fn() } }],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(ReportsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const argumentos = (nombre: string) => mcp.mock.calls.filter(([, p]) => p.name === nombre).map(([, p]) => p.arguments);

  it('carga el catálogo y marca todas las columnas de la primera entidad', async () => {
    const fixture = await crear();
    expect(fixture.componentInstance.entityKey()).toBe('facturas');
    expect([...fixture.componentInstance.columns()]).toEqual(['fecha', 'servicio', 'total']);
    // Solo se agrupa por columnas de texto
    expect(fixture.componentInstance.groupable().map((c) => c.clave)).toEqual(['fecha', 'servicio']);
  });

  it('arma la petición con columnas, fechas, criterios, agrupación y formato', async () => {
    const fixture = await crear();
    const pantalla = fixture.componentInstance;
    pantalla.toggleColumn('fecha');
    pantalla.from = '2026-11-01';
    pantalla.to = '2026-11-30';
    pantalla.filters = { estado: 'Emitida', cliente: '' };
    pantalla.groupBy = 'servicio';
    pantalla.format = 'pdf';
    await pantalla.generate();

    expect(argumentos('generar_reporte')[0]).toEqual({
      entidad: 'facturas', columnas: ['servicio', 'total'], filtros: { estado: 'Emitida' },
      formato: 'pdf', desde: '2026-11-01', hasta: '2026-11-30', agrupar_por: 'servicio',
    });
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Balayage');
    expect(texto).toContain('$120.00');
    expect(texto).toContain('Descargar PDF');
  });

  it('una entidad sin fechas no manda desde ni hasta', async () => {
    const fixture = await crear();
    fixture.componentInstance.from = '2026-11-01';
    fixture.componentInstance.selectEntity('inventario');
    await fixture.componentInstance.generate();
    expect(argumentos('generar_reporte')[0]).toEqual({ entidad: 'inventario', columnas: ['insumo'], filtros: {}, formato: 'excel' });
  });

  it('pide el reporte al agente de reportes y muestra su respuesta y su archivo', async () => {
    const fixture = await crear();
    fixture.componentInstance.prompt = 'facturas de noviembre en pdf';
    fixture.componentInstance.askAgent();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(argumentos('preguntar_al_agente')[0]).toEqual({ prompt: 'facturas de noviembre en pdf', agente: 'reportes' });
    expect(fixture.componentInstance.agentAnswer()).toBe('Listo: 1 factura.');
    expect(fixture.componentInstance.reports().length).toBe(1);
  });

  it('descarga el archivo que vino en la respuesta, sin otra petición', async () => {
    const fixture = await crear();
    const crearUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prueba');
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fixture.componentInstance.download(REPORTE as any);
    const blob = crearUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe('%PDF-1.3'.length);
    expect(clic).toHaveBeenCalled();
    expect(mcp.mock.calls.filter(([, p]) => p.name === 'generar_reporte').length).toBe(0);
  });

  it('muestra el error real de la herramienta', async () => {
    mcp.mockImplementation(async (_m: string, p: { name: string }) =>
      p.name === 'catalogo_reportes' ? ok(CATALOGO) : { isError: true, content: [{ type: 'text', text: 'Columnas no válidas' }] });
    const fixture = await crear();
    await fixture.componentInstance.generate();
    expect(fixture.componentInstance.error()).toBe('Columnas no válidas');
  });
});
