import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { daysAgo, isoDate, messageOf } from '../core/config';
import { InventoryItem, Notice } from '../core/models';

interface Summary {
  totalAppointments: number;
  active: number;
  completed: number;
  cancelled: number;
  occupancyRate: number;
}

interface Billing {
  revenue: number;
  refunded: number;
  invoicesIssued: number;
  pointsEarned: number;
  totalClients: number;
}

const PERIOD_DAYS = 29;

/** Indicadores de los últimos 30 días, insumos críticos y avisos del personal (CU-17). */
@Component({
  selector: 'app-panel',
  imports: [DecimalPipe, PercentPipe],
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (auth.isAdmin() && summary(); as s) {
      <section class="card" id="panel-kpis">
        <h2>Últimos 30 días</h2>
        <div class="grid">
          <div class="kpi"><strong id="kpi-total">{{ s.totalAppointments }}</strong><span>Citas</span></div>
          <div class="kpi"><strong>{{ s.active }}</strong><span>Activas</span></div>
          <div class="kpi"><strong>{{ s.completed }}</strong><span>Atendidas</span></div>
          <div class="kpi"><strong>{{ s.cancelled }}</strong><span>Canceladas</span></div>
          <div class="kpi"><strong>{{ s.occupancyRate | percent: '1.0-1' }}</strong><span>Ocupación</span></div>
          @if (billing(); as b) {
            <div class="kpi"><strong id="kpi-revenue">{{ '$' }}{{ b.revenue | number: '1.2-2' }}</strong><span>Ingresos netos</span></div>
            <div class="kpi"><strong>{{ '$' }}{{ b.refunded | number: '1.2-2' }}</strong><span>Reembolsado</span></div>
            <div class="kpi"><strong>{{ b.invoicesIssued }}</strong><span>Facturas</span></div>
            <div class="kpi"><strong>{{ b.pointsEarned }}</strong><span>Puntos otorgados</span></div>
            <div class="kpi"><strong>{{ b.totalClients }}</strong><span>Clientes</span></div>
          }
        </div>
      </section>
    }

    <section class="card">
      <h2>Insumos en nivel crítico</h2>
      @for (item of critical(); track item.id) {
        <p class="critical-item"><span class="badge bad">{{ item.currentStock }} / {{ item.minimumStock }}</span> {{ item.name }}</p>
      } @empty {
        <p class="muted">No hay insumos en nivel crítico.</p>
      }
    </section>

    <section class="card">
      <h2>Avisos</h2>
      @for (notice of notices(); track notice.id) {
        <div class="row notice-row" style="justify-content: space-between; margin-bottom: 8px;">
          <div>
            <strong>{{ notice.title }}</strong> @if (!notice.read) { <span class="badge good">Nuevo</span> }
            <div class="muted">{{ notice.message }}</div>
          </div>
          @if (!notice.read) {
            <button type="button" class="secondary" (click)="markRead(notice)">Marcar como leído</button>
          }
        </div>
      } @empty {
        <p class="muted">No tiene avisos.</p>
      }
    </section>
  `,
})
export class PanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly summary = signal<Summary | null>(null);
  readonly billing = signal<Billing | null>(null);
  readonly critical = signal<InventoryItem[]>([]);
  readonly notices = signal<Notice[]>([]);
  readonly error = signal('');

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const staff = await Promise.all([
        this.api.gestion<{ getCriticalStockItems: InventoryItem[] }>('{ getCriticalStockItems { id name currentStock minimumStock } }'),
        this.api.crm<{ getMyNotices: Notice[] }>('{ getMyNotices { id type title message read createdAt } }'),
      ]);
      this.critical.set(staff[0].getCriticalStockItems);
      this.notices.set(staff[1].getMyNotices);

      if (this.auth.isAdmin()) {
        const period = { from: daysAgo(PERIOD_DAYS), to: isoDate(new Date()) };
        const [operation, finance] = await Promise.all([
          this.api.gestion<{ getPanelSummary: Summary }>(
            'query ($from: String!, $to: String!) { getPanelSummary(from: $from, to: $to) { totalAppointments active completed cancelled occupancyRate } }',
            period,
          ),
          this.api.crm<{ getCrmMetrics: Billing }>(
            'query ($from: String!, $to: String!) { getCrmMetrics(from: $from, to: $to) { revenue refunded invoicesIssued pointsEarned totalClients } }',
            period,
          ),
        ]);
        this.summary.set(operation.getPanelSummary);
        this.billing.set(finance.getCrmMetrics);
      }
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  async markRead(notice: Notice): Promise<void> {
    try {
      await this.api.crm('mutation ($id: ID!) { markNoticeRead(id: $id) }', { id: notice.id });
      this.notices.update((all) => all.map((other) => (other.id === notice.id ? { ...other, read: true } : other)));
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }
}
