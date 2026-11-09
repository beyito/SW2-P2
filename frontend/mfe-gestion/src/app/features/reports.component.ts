import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { CONFIG, messageOf } from '../core/config';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: any;
}

interface Column { clave: string; etiqueta: string; tipo: 'texto' | 'numero' | 'dinero' }
interface Filter { clave: string; modo: 'contiene' | 'igual' | 'verdadero'; valores?: string[] }
interface Entity { clave: string; titulo: string; filtraPorFecha: boolean; columnas: Column[]; filtros: Filter[] }

/** Lo que devuelve generar_reporte: vista previa, totales y el archivo en base64. */
interface Report {
  titulo: string;
  formato: string;
  columnas: Column[];
  filtrosAplicados: string[];
  totalFilas: number;
  truncado: boolean;
  totales: Record<string, number>;
  vistaPrevia: Record<string, string | number>[];
  archivo: { nombre: string; tipoMime: string; bytes: number; base64: string };
}

const MAX_RECORDING_MS = 30000;
const FILTER_LABELS: Record<string, string> = {
  estilista: 'Estilista', servicio: 'Servicio', estado: 'Estado', cliente: 'Cliente', metodo_pago: 'Método de pago',
  categoria: 'Categoría', insumo: 'Insumo', motivo: 'Motivo', tipo: 'Tipo', solo_criticos: 'Solo críticos',
};

/**
 * Reportes dinámicos (CU-18, RF-11). Se piden con palabras (texto o voz, al agente de reportes) o
 * armándolos a mano: entidad, columnas, criterios, agrupación y formato Excel o PDF.
 * Todo pasa por el Servidor MCP, que consulta la base con un usuario de solo lectura (RNF-02).
 */
@Component({
  selector: 'app-reports',
  imports: [FormsModule],
  template: `
    <section class="card row" style="justify-content: space-between; align-items: center;">
      <div>
        <h2 style="margin: 0;">Inteligencia de negocios</h2>
        <small class="muted">Tablero en Python con KPI sobre dos años de historia: ingresos, ocupación, clientes y márgenes.</small>
      </div>
      <a class="button primary" id="open-bi" [href]="biUrl" target="_blank" rel="noopener">Abrir el tablero</a>
    </section>

    <section class="card">
      <h2>Pedir un reporte con palabras</h2>
      <p class="muted">Por ejemplo: «facturas de noviembre agrupadas por servicio, en PDF» o «citas canceladas de Valentina este mes con fecha, hora y servicio».</p>
      @if (loadError()) { <p class="error" role="alert">{{ loadError() }}</p> }
      <form class="row" (ngSubmit)="askAgent()">
        <input id="report-prompt" class="wide" style="flex: 1;" name="prompt" placeholder="Describa el reporte que necesita" [(ngModel)]="prompt" required>
        <button class="primary" type="submit" id="report-ask" [disabled]="busy() || recording()">Generar</button>
        <button type="button" class="secondary" id="report-mic" [disabled]="busy()" (click)="toggleRecording()">{{ recording() ? 'Detener y enviar' : 'Pedir por voz' }}</button>
      </form>
      @if (agentAnswer()) { <p class="bubble agent" id="report-answer">{{ agentAnswer() }}</p> }
    </section>

    <section class="card">
      <h2>Armar el reporte</h2>
      <form (ngSubmit)="generate()">
        <div class="row">
          <label>Entidad
            <select id="report-entity" name="entity" [ngModel]="entityKey()" (ngModelChange)="selectEntity($event)">
              @for (entity of entities(); track entity.clave) { <option [value]="entity.clave">{{ entity.titulo }}</option> }
            </select>
          </label>
          @if (entity()?.filtraPorFecha) {
            <label>Desde <input id="report-from" type="date" name="from" [(ngModel)]="from"></label>
            <label>Hasta <input id="report-to" type="date" name="to" [(ngModel)]="to"></label>
          }
          <label>Agrupar por
            <select id="report-group" name="group" [(ngModel)]="groupBy">
              <option value="">Sin agrupar</option>
              @for (column of groupable(); track column.clave) { <option [value]="column.clave">{{ column.etiqueta }}</option> }
            </select>
          </label>
          <label>Formato
            <select id="report-format" name="format" [(ngModel)]="format">
              <option value="excel">Excel</option><option value="pdf">PDF</option>
            </select>
          </label>
        </div>

        <h3>Columnas</h3>
        <div class="row" role="group" aria-label="Columnas del reporte">
          @for (column of entity()?.columnas ?? []; track column.clave) {
            <label class="inline"><input type="checkbox" class="report-column" [attr.data-column]="column.clave" [checked]="columns().has(column.clave)" (change)="toggleColumn(column.clave)"> {{ column.etiqueta }}</label>
          }
        </div>

        <h3>Criterios</h3>
        <div class="row">
          @for (filter of entity()?.filtros ?? []; track filter.clave) {
            @if (filter.modo === 'verdadero') {
              <label class="inline"><input type="checkbox" [id]="'report-filter-' + filter.clave" [name]="filter.clave" [(ngModel)]="filters[filter.clave]"> {{ label(filter.clave) }}</label>
            } @else if (filter.valores) {
              <label>{{ label(filter.clave) }}
                <select [id]="'report-filter-' + filter.clave" [name]="filter.clave" [(ngModel)]="filters[filter.clave]">
                  <option value="">Todos</option>
                  @for (value of filter.valores; track value) { <option [value]="value">{{ value }}</option> }
                </select>
              </label>
            } @else {
              <label>{{ label(filter.clave) }} <input [id]="'report-filter-' + filter.clave" [name]="filter.clave" [(ngModel)]="filters[filter.clave]" placeholder="Contiene..."></label>
            }
          }
        </div>
        <button class="primary" type="submit" id="report-generate" [disabled]="busy() || !columns().size">Generar reporte</button>
      </form>
    </section>

    @if (error()) { <p class="error card" role="alert" id="report-error">{{ error() }}</p> }
    @if (busy()) { <p class="card muted" id="report-busy">Generando el reporte...</p> }

    @for (report of reports(); track report.archivo.nombre + $index) {
      <section class="card report-result">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div>
            <h2 style="margin: 0;">{{ report.titulo }}</h2>
            <small class="muted">
              {{ report.totalFilas }} registros{{ report.truncado ? ' (limitado)' : '' }} ·
              {{ report.filtrosAplicados.length ? report.filtrosAplicados.join('; ') : 'sin filtros' }}
            </small>
          </div>
          <button type="button" class="primary btn-download" (click)="download(report)">
            Descargar {{ report.formato === 'pdf' ? 'PDF' : 'Excel' }} ({{ kilobytes(report) }} KB)
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>@for (column of report.columnas; track column.clave) { <th>{{ column.etiqueta }}</th> }</tr></thead>
            <tbody>
              @for (row of report.vistaPrevia; track $index) {
                <tr class="report-row">@for (column of report.columnas; track column.clave) { <td>{{ show(row[column.clave], column) }}</td> }</tr>
              } @empty {
                <tr><td [attr.colspan]="report.columnas.length" class="muted">Ningún registro cumple los criterios.</td></tr>
              }
              @if (hasTotals(report)) {
                <tr class="report-total">
                  @for (column of report.columnas; track column.clave; let first = $first) {
                    <td><strong>{{ column.clave in report.totales ? show(report.totales[column.clave], column) : (first ? 'Total' : '') }}</strong></td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (report.totalFilas > report.vistaPrevia.length) {
          <small class="muted">La vista previa muestra {{ report.vistaPrevia.length }} de {{ report.totalFilas }} registros; el archivo los incluye todos.</small>
        }
      </section>
    }
  `,
})
export class ReportsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly biUrl = CONFIG.biUrl;
  readonly entities = signal<Entity[]>([]);
  readonly entityKey = signal('');
  readonly entity = computed(() => this.entities().find((e) => e.clave === this.entityKey()));
  readonly groupable = computed(() => (this.entity()?.columnas ?? []).filter((c) => c.tipo === 'texto'));
  readonly columns = signal(new Set<string>());
  readonly reports = signal<Report[]>([]);
  readonly busy = signal(false);
  readonly recording = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');
  readonly agentAnswer = signal('');
  filters: Record<string, string | boolean> = {};
  from = '';
  to = '';
  groupBy = '';
  format = 'excel';
  prompt = '';
  private recorder: MediaRecorder | null = null;
  private recordingTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.call('catalogo_reportes', {})
      .then((catalog) => {
        this.entities.set(catalog.entidades);
        this.selectEntity(catalog.entidades[0]?.clave ?? '');
      })
      .catch((error) => this.loadError.set(messageOf(error)));
  }

  ngOnDestroy(): void {
    if (this.recorder) {
      this.recorder.onstop = null;
      this.releaseMicrophone();
    }
  }

  label(key: string): string {
    return FILTER_LABELS[key] ?? key;
  }

  selectEntity(key: string): void {
    this.entityKey.set(key);
    this.columns.set(new Set(this.entity()?.columnas.map((c) => c.clave) ?? []));
    this.filters = {};
    this.groupBy = '';
  }

  toggleColumn(key: string): void {
    const next = new Set(this.columns());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.columns.set(next);
  }

  /** Arma la petición con lo elegido en el formulario y la manda tal cual a la herramienta. */
  async generate(): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    const filtros = Object.fromEntries(Object.entries(this.filters).filter(([, value]) => value !== '' && value !== false && value != null));
    const args = {
      entidad: entity.clave,
      // Se respeta el orden del catálogo
      columnas: entity.columnas.map((c) => c.clave).filter((key) => this.columns().has(key)),
      filtros,
      formato: this.format,
      ...(entity.filtraPorFecha && this.from ? { desde: this.from } : {}),
      ...(entity.filtraPorFecha && this.to ? { hasta: this.to } : {}),
      ...(this.groupBy ? { agrupar_por: this.groupBy } : {}),
    };
    await this.run(async () => {
      const report: Report = await this.call('generar_reporte', args);
      this.reports.update((all) => [report, ...all]);
    });
  }

  askAgent(): void {
    const question = this.prompt.trim();
    if (!question) return;
    this.prompt = '';
    void this.askWith(question);
  }

  /** La voz se convierte en la misma petición de texto (Whisper en ms-ia). */
  async toggleRecording(): Promise<void> {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.error.set('No se pudo abrir el micrófono. Revise el permiso del navegador.');
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      this.releaseMicrophone();
      void this.run(async () => {
        const question = await this.api.transcribe(new Blob(chunks, { type: recorder.mimeType }));
        this.prompt = question;
        await this.askWith(question);
      });
    };
    recorder.start();
    this.recording.set(true);
    this.recordingTimer = setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
  }

  private async askWith(question: string): Promise<void> {
    await this.run(async () => {
      const result = await this.call('preguntar_al_agente', { prompt: question, agente: 'reportes' });
      this.agentAnswer.set(result.generatedReport ?? '');
      if (result.reports?.length) this.reports.update((all) => [...result.reports, ...all]);
    });
  }

  /** El archivo llega en base64 dentro de la respuesta MCP: se descarga sin otra petición. */
  download(report: Report): void {
    const bytes = Uint8Array.from(atob(report.archivo.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: report.archivo.tipoMime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = report.archivo.nombre;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  kilobytes(report: Report): string {
    return (report.archivo.bytes / 1024).toFixed(1);
  }

  hasTotals(report: Report): boolean {
    return Object.keys(report.totales ?? {}).length > 0;
  }

  show(value: string | number | undefined, column: Column): string {
    if (value === undefined || value === null || value === '') return '';
    return column.tipo === 'dinero' ? `$${Number(value).toFixed(2)}` : String(value);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await task();
    } catch (error) {
      this.error.set(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async call(tool: string, args: object): Promise<any> {
    const result = await this.api.mcp<ToolResult>('tools/call', { name: tool, arguments: args });
    if (result.isError) throw new Error(result.content[0]?.text ?? 'La herramienta falló.');
    return result.structuredContent;
  }

  private releaseMicrophone(): void {
    clearTimeout(this.recordingTimer);
    this.recorder?.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
    this.recording.set(false);
  }
}
