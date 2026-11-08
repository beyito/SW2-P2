import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { messageOf } from '../core/config';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: any;
}

interface PendingAction {
  actionId: string;
  summary: string;
  reason?: string;
  state: 'PENDING' | 'WORKING' | 'CONFIRMED' | 'REJECTED';
  error?: string;
}

interface Message {
  from: 'user' | 'agent';
  text: string;
  note?: string;
  failed?: boolean;
  actions?: PendingAction[];
}

const AGENT_TOOL = 'preguntar_al_agente';
const MAX_RECORDING_MS = 30000;

/** Cada uno corresponde a una Skill del Servidor MCP. */
const AGENTS = [
  { id: 'operacion', label: 'Operación', placeholder: 'Pregunte sobre la operación del salón' },
  { id: 'inventario', label: 'Inventario', placeholder: 'Por ejemplo: ¿qué insumos debo reponer?' },
  { id: 'agenda', label: 'Agenda', placeholder: 'Por ejemplo: ¿qué turnos quedan libres mañana?' },
];

/** Consultas predefinidas; solo se ofrecen las herramientas que el rol tiene permitidas. */
const PRESETS = [
  { tool: 'consultar_stock_critico', label: 'Stock crítico', args: {} },
  { tool: 'obtener_metricas_negocio', label: 'Métricas de la semana', args: { period: 'WEEKLY' } },
  { tool: 'obtener_metricas_negocio', label: 'Métricas del mes', args: { period: 'MONTHLY' } },
  { tool: 'listar_estilistas', label: 'Estilistas', args: {} },
];

const money = (value: number) => `$${Number(value).toFixed(2)}`;

/** Convierte el resultado de cada herramienta en un texto legible. */
function describe(tool: string, data: any): { text: string; note?: string } {
  switch (tool) {
    case 'consultar_stock_critico':
      return {
        text: data.items.length
          ? data.items.map((item: any) => `- ${item.name}: ${item.currentStock} (mínimo ${item.minimumStock}, faltan ${item.shortage})`).join('\n')
          : 'No hay insumos en nivel crítico.',
      };
    case 'obtener_metricas_negocio': {
      const { appointments: a, billing: b, range } = data;
      return {
        text: [
          `Del ${range.from} al ${range.to}:`,
          `- Citas: ${a.totalAppointments} (${a.active} activas, ${a.completed} atendidas, ${a.cancelled} canceladas)`,
          `- Ocupación: ${(a.occupancyRate * 100).toFixed(1)}%`,
          `- Ingresos netos: ${money(b.revenue)} con ${b.invoicesIssued} facturas; reembolsado: ${money(b.refunded)}`,
          `- Puntos: ${b.pointsEarned} otorgados y ${b.pointsRedeemed} canjeados`,
        ].join('\n'),
      };
    }
    case 'listar_estilistas':
      return { text: data.stylists.map((stylist: any) => `- ${stylist.name}${stylist.specialty ? ` (${stylist.specialty})` : ''}`).join('\n') };
    case AGENT_TOOL:
      return {
        text: data.generatedReport,
        note: data.toolsUsed.length ? `Motor: ${data.engine}. Consultó: ${data.toolsUsed.join(', ')}.` : `Motor: ${data.engine}`,
      };
    default:
      return { text: JSON.stringify(data) };
  }
}

/** Agente del ERP: consulta datos reales únicamente a través del Servidor MCP (CU-17, CU-18, RNF-02). */
@Component({
  selector: 'app-agent',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Asistentes del salón</h2>
      @if (loadError()) { <p class="error" role="alert">{{ loadError() }}</p> }

      <div class="chat" id="agent-chat">
        @for (message of messages(); track $index) {
          <div class="bubble" [class.user]="message.from === 'user'" [class.agent]="message.from === 'agent'" [class.failed]="message.failed">
            {{ message.text }}
            @if (message.note) { <small class="agent-note">{{ message.note }}</small> }
            @for (action of message.actions; track action.actionId) {
              <div class="agent-action" [attr.data-state]="action.state">
                <strong class="action-summary">{{ action.summary }}</strong>
                @if (action.reason) { <small>Motivo indicado por el agente: {{ action.reason }}</small> }
                @switch (action.state) {
                  @case ('PENDING') {
                    <small>Todavía no se hizo ningún cambio.</small>
                    <div class="row">
                      <button type="button" class="primary btn-action-confirm" (click)="decide(action, 'confirmar_accion')">Confirmar</button>
                      <button type="button" class="secondary btn-action-reject" (click)="decide(action, 'rechazar_accion')">Rechazar</button>
                    </div>
                  }
                  @case ('WORKING') { <small>Aplicando...</small> }
                  @case ('CONFIRMED') { <small class="action-done">Confirmado y aplicado.</small> }
                  @case ('REJECTED') { <small class="action-done">Rechazado: no se hizo ningún cambio.</small> }
                }
                @if (action.error) { <small class="action-error" role="alert">{{ action.error }}</small> }
              </div>
            }
          </div>
        }
        @if (busy()) { <div class="bubble agent muted" id="agent-busy">Consultando...</div> }
      </div>

      <div class="row" style="margin-bottom: 10px;">
        @for (preset of presets(); track preset.label) {
          <button type="button" class="secondary btn-preset" [disabled]="busy()" (click)="ask(preset.tool, preset.args, preset.label)">{{ preset.label }}</button>
        }
      </div>

      @if (canReport()) {
        <div class="row" style="margin-bottom: 10px;" role="group" aria-label="Agente que responde">
          @for (agent of agents; track agent.id) {
            <button type="button" [id]="'agent-select-' + agent.id" [class]="selected().id === agent.id ? 'primary' : 'secondary'" [attr.aria-pressed]="selected().id === agent.id" (click)="selected.set(agent)">{{ agent.label }}</button>
          }
        </div>
        <form class="row" (ngSubmit)="askReport()">
          <input id="agent-prompt" class="wide" style="flex: 1;" name="prompt" [placeholder]="selected().placeholder" [(ngModel)]="prompt" required>
          <button class="primary" type="submit" id="agent-send" [disabled]="busy() || recording()">Preguntar</button>
          <button type="button" class="secondary" id="agent-mic" [disabled]="busy()" (click)="toggleRecording()">{{ recording() ? 'Detener y enviar' : 'Preguntar por voz' }}</button>
        </form>
      }
    </section>
  `,
})
export class AgentComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly tools = signal<string[]>([]);
  readonly presets = computed(() => PRESETS.filter((preset) => this.tools().includes(preset.tool)));
  readonly canReport = computed(() => this.tools().includes(AGENT_TOOL));
  readonly agents = AGENTS;
  readonly selected = signal(AGENTS[0]);
  readonly messages = signal<Message[]>([]);
  readonly busy = signal(false);
  readonly loadError = signal('');
  readonly recording = signal(false);
  prompt = '';
  private recorder: MediaRecorder | null = null;
  private recordingTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.api
      .mcp<{ tools: { name: string }[] }>('tools/list')
      .then(({ tools }) => this.tools.set(tools.map((tool) => tool.name)))
      .catch((error) => this.loadError.set(messageOf(error)));
  }

  ngOnDestroy(): void {
    // Al salir de la pantalla se apaga el micrófono y se descarta lo grabado
    if (this.recorder) {
      this.recorder.onstop = null;
      this.releaseMicrophone();
    }
  }

  async toggleRecording(): Promise<void> {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.messages.update((all) => [...all, { from: 'agent', text: 'No se pudo abrir el micrófono. Revise el permiso del navegador.', failed: true }]);
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      this.releaseMicrophone();
      void this.askByVoice(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.start();
    this.recording.set(true);
    this.recordingTimer = setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
  }

  private releaseMicrophone(): void {
    clearTimeout(this.recordingTimer);
    this.recorder?.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
    this.recording.set(false);
  }

  /** La voz solo se convierte en la misma pregunta de texto: el reporte sigue pasando por el Servidor MCP. */
  private async askByVoice(audio: Blob): Promise<void> {
    this.busy.set(true);
    try {
      const question = await this.api.transcribe(audio);
      await this.ask(AGENT_TOOL, { prompt: question, agente: this.selected().id }, question);
    } catch (error) {
      this.messages.update((all) => [...all, { from: 'agent', text: messageOf(error), failed: true }]);
    } finally {
      this.busy.set(false);
    }
  }

  askReport(): void {
    const question = this.prompt.trim();
    if (!question) return;
    this.prompt = '';
    void this.ask(AGENT_TOOL, { prompt: question, agente: this.selected().id }, question);
  }

  /** La decisión sobre una propuesta solo sale de este botón: el modelo no dispone de estas herramientas. */
  async decide(action: PendingAction, tool: 'confirmar_accion' | 'rechazar_accion'): Promise<void> {
    const update = (changes: Partial<PendingAction>) => {
      Object.assign(action, changes);
      this.messages.update((all) => [...all]);
    };
    update({ state: 'WORKING', error: undefined });
    try {
      const result = await this.api.mcp<ToolResult>('tools/call', { name: tool, arguments: { actionId: action.actionId } });
      if (result.isError) {
        // La propuesta se retira al intentarla: si falló, hay que pedirla otra vez con datos actuales
        update({ state: 'REJECTED', error: `No se aplicó: ${result.content[0]?.text ?? 'la herramienta falló.'}` });
        return;
      }
      update({ state: tool === 'confirmar_accion' ? 'CONFIRMED' : 'REJECTED' });
    } catch (error) {
      update({ state: 'PENDING', error: messageOf(error) });
    }
  }

  async ask(tool: string, args: object, label: string): Promise<void> {
    this.messages.update((all) => [...all, { from: 'user', text: label }]);
    this.busy.set(true);
    try {
      const result = await this.api.mcp<ToolResult>('tools/call', { name: tool, arguments: args });
      const reply: Message = result.isError
        ? { from: 'agent', text: result.content[0]?.text ?? 'La herramienta falló.', failed: true }
        : {
            from: 'agent',
            ...describe(tool, result.structuredContent),
            actions: (result.structuredContent?.pendingActions ?? []).map((action: PendingAction) => ({ ...action, state: 'PENDING' })),
          };
      this.messages.update((all) => [...all, reply]);
    } catch (error) {
      this.messages.update((all) => [...all, { from: 'agent', text: messageOf(error), failed: true }]);
    } finally {
      this.busy.set(false);
    }
  }
}
