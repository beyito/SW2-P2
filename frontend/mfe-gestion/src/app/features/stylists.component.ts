import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { messageOf } from '../core/config';
import { Stylist, StylistSchedule } from '../core/models';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FIELDS = 'id name specialty phone active rating { average count } schedules { dayOfWeek startTime endTime isAvailable }';

const emptyDraft = () => ({ id: '', name: '', specialty: '', phone: '' });

/** Fila editable del horario: un bloque por cada día de la semana. */
function weekOf(stylist: Stylist): StylistSchedule[] {
  return DAYS.map((_, index) => {
    const dayOfWeek = index + 1;
    const block = stylist.schedules.find((schedule) => schedule.dayOfWeek === dayOfWeek);
    return block
      ? { ...block, startTime: block.startTime.slice(0, 5), endTime: block.endTime.slice(0, 5) }
      : { dayOfWeek, startTime: '09:00', endTime: '18:00', isAvailable: false };
  });
}

/** Registrar y modificar estilistas (CU-04) y gestionar sus horarios (CU-05). */
@Component({
  selector: 'app-stylists',
  imports: [DecimalPipe, FormsModule],
  template: `
    <section class="card">
      <h2>Estilistas</h2>
      @if (error()) { <p class="error" role="alert" id="stylist-error">{{ error() }}</p> }
      @if (saved()) { <p class="success" role="status">{{ saved() }}</p> }

      <div class="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Especialidad</th><th>Teléfono</th><th>Calificación</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            @for (stylist of stylists(); track stylist.id) {
              <tr class="stylist-row" [attr.data-name]="stylist.name" [class.selected]="selectedId() === stylist.id">
                <td>{{ stylist.name }}</td>
                <td>{{ stylist.specialty }}</td>
                <td>{{ stylist.phone }}</td>
                <td>
                  @if (stylist.rating.count) {
                    {{ stylist.rating.average | number: '1.1-1' }} ★ ({{ stylist.rating.count }})
                  } @else { <span class="muted">Sin reseñas</span> }
                </td>
                <td><span class="badge status" [class.good]="stylist.active" [class.bad]="!stylist.active">{{ stylist.active ? 'Activo' : 'Inactivo' }}</span></td>
                <td class="row">
                  @if (canEditSchedule(stylist)) {
                    <button type="button" class="secondary btn-schedule" (click)="select(stylist)">Horario</button>
                  }
                  @if (auth.isAdmin()) {
                    <button type="button" class="secondary btn-edit" (click)="edit(stylist)">Editar</button>
                    <button type="button" class="btn-toggle" [class.danger]="stylist.active" [class.secondary]="!stylist.active" (click)="toggle(stylist)">
                      {{ stylist.active ? 'Desactivar' : 'Activar' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (selected(); as stylist) {
      <section class="card" id="schedule-editor">
        <h2>Horario de {{ stylist.name }}</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Día</th><th>Atiende</th><th>Entrada</th><th>Salida</th><th></th></tr></thead>
            <tbody>
              @for (block of week(); track block.dayOfWeek) {
                <tr class="schedule-row" [attr.data-day]="block.dayOfWeek">
                  <td>{{ dayName(block.dayOfWeek) }}</td>
                  <td><input type="checkbox" class="sch-available" [name]="'a' + block.dayOfWeek" [(ngModel)]="block.isAvailable"></td>
                  <td><input type="time" class="sch-start" [name]="'s' + block.dayOfWeek" [(ngModel)]="block.startTime"></td>
                  <td><input type="time" class="sch-end" [name]="'e' + block.dayOfWeek" [(ngModel)]="block.endTime"></td>
                  <td><button type="button" class="primary sch-save" (click)="saveBlock(stylist, block)">Guardar</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (auth.isAdmin()) {
      <section class="card">
        <h2>{{ draft.id ? 'Modificar estilista' : 'Registrar estilista' }}</h2>
        <form class="row" (ngSubmit)="saveStylist()">
          <label>Nombre <input id="stylist-name" class="wide" name="name" [(ngModel)]="draft.name" required></label>
          <label>Especialidad <input id="stylist-specialty" name="specialty" [(ngModel)]="draft.specialty"></label>
          <label>Teléfono <input id="stylist-phone" name="phone" [(ngModel)]="draft.phone"></label>
          <button class="primary" type="submit" id="stylist-save">Guardar</button>
          @if (draft.id) { <button class="secondary" type="button" (click)="draft = newDraft()">Cancelar</button> }
        </form>
      </section>
    }
  `,
})
export class StylistsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly stylists = signal<Stylist[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.stylists().find((stylist) => stylist.id === this.selectedId()) ?? null);
  readonly week = signal<StylistSchedule[]>([]);
  readonly error = signal('');
  readonly saved = signal('');
  readonly newDraft = emptyDraft;
  draft = emptyDraft();

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { getAllStylists } = await this.api.gestion<{ getAllStylists: Stylist[] }>(`{ getAllStylists { ${FIELDS} } }`);
      this.stylists.set(getAllStylists);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  dayName(day: number): string {
    return DAYS[day - 1];
  }

  /** La administración y la recepción configuran cualquier horario; un estilista, solo el suyo. */
  canEditSchedule(stylist: Stylist): boolean {
    return this.auth.isDesk() || stylist.id === this.auth.userId();
  }

  select(stylist: Stylist): void {
    this.selectedId.set(stylist.id);
    this.week.set(weekOf(stylist));
  }

  edit(stylist: Stylist): void {
    this.draft = { id: stylist.id, name: stylist.name, specialty: stylist.specialty ?? '', phone: stylist.phone ?? '' };
  }

  private async run(action: () => Promise<unknown>, message: string): Promise<boolean> {
    this.error.set('');
    this.saved.set('');
    try {
      await action();
      await this.load();
      this.saved.set(message);
      return true;
    } catch (error) {
      this.error.set(messageOf(error));
      return false;
    }
  }

  async saveStylist(): Promise<void> {
    const input = { name: this.draft.name, specialty: this.draft.specialty || null, phone: this.draft.phone || null };
    const done = await this.run(
      () => this.draft.id
        ? this.api.gestion('mutation ($id: ID!, $i: StylistInput!) { updateStylist(id: $id, input: $i) { id } }', { id: this.draft.id, i: input })
        : this.api.gestion('mutation ($i: StylistInput!) { createStylist(input: $i) { id } }', { i: input }),
      'Estilista guardado.',
    );
    if (done) this.draft = emptyDraft();
  }

  async toggle(stylist: Stylist): Promise<void> {
    await this.run(
      () => this.api.gestion('mutation ($id: ID!, $a: Boolean!) { setStylistActive(id: $id, active: $a) { id } }', { id: stylist.id, a: !stylist.active }),
      stylist.active ? 'Estilista desactivado.' : 'Estilista activado.',
    );
  }

  async saveBlock(stylist: Stylist, block: StylistSchedule): Promise<void> {
    await this.run(
      () => this.api.gestion('mutation ($i: ScheduleInput!) { setStylistSchedule(input: $i) { id } }', {
        i: { stylistId: stylist.id, dayOfWeek: block.dayOfWeek, startTime: block.startTime, endTime: block.endTime, isAvailable: block.isAvailable },
      }),
      `Horario del ${this.dayName(block.dayOfWeek)} guardado.`,
    );
  }
}
