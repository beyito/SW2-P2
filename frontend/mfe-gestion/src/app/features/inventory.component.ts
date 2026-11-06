import { CurrencyPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { messageOf } from '../core/config';
import { InventoryItem } from '../core/models';

const FIELDS = 'id code name category currentStock minimumStock reservedStock unitPrice isCriticalStock';

const emptyItem = () => ({ code: '', name: '', category: 'COLORACION', initialStock: 0, minimumStock: 0, unitPrice: 0 });

/** Inventario real: alta de insumos, movimientos de stock y stock mínimo (CU-08, CU-09, RF-03). */
@Component({
  selector: 'app-inventory',
  imports: [CurrencyPipe, FormsModule],
  template: `
    <section class="card">
      <h2>Insumos</h2>
      @if (error()) { <p class="error" role="alert" id="inventory-error">{{ error() }}</p> }
      @if (saved()) { <p class="success" role="status">{{ saved() }}</p> }

      <div class="table-wrap">
        <table>
          <thead><tr><th>Código</th><th>Insumo</th><th>Categoría</th><th>Stock</th><th>Reservado</th><th>Mínimo</th><th>Precio</th><th></th></tr></thead>
          <tbody>
            @for (item of items(); track item.id) {
              <tr class="inventory-row" [attr.data-code]="item.code" [class.selected]="editing()?.id === item.id">
                <td>{{ item.code }}</td>
                <td>{{ item.name }}</td>
                <td>{{ item.category }}</td>
                <td class="stock">
                  {{ item.currentStock }}
                  @if (item.isCriticalStock) { <span class="badge bad">Crítico</span> }
                </td>
                <td>{{ item.reservedStock ?? 0 }}</td>
                <td class="minimum">{{ item.minimumStock }}</td>
                <td>{{ item.unitPrice | currency: 'USD' }}</td>
                <td>
                  @if (auth.isAdmin()) {
                    <button type="button" class="secondary btn-edit" (click)="edit(item)">Ajustar</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="muted">No hay insumos registrados.</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (editing(); as item) {
        <h3>Ajustar: {{ item.name }}</h3>
        <form class="row" (ngSubmit)="saveMinimum(item)">
          <label>Stock mínimo <input id="edit-minimum" type="number" min="0" name="minimum" [(ngModel)]="minimum" required></label>
          <button class="primary" type="submit" id="save-minimum">Guardar mínimo</button>
        </form>
        <form class="row" style="margin-top: 8px;" (ngSubmit)="saveMovement(item)">
          <label>Cantidad (+ entra, − sale) <input id="edit-change" type="number" name="change" [(ngModel)]="change" required></label>
          <label>Motivo <input id="edit-reason" class="wide" name="reason" [(ngModel)]="reason" required></label>
          <button class="primary" type="submit" id="save-movement">Registrar movimiento</button>
          <button class="secondary" type="button" (click)="editing.set(null)">Cerrar</button>
        </form>
      }
    </section>

    @if (auth.isAdmin()) {
      <section class="card">
        <h2>Registrar insumo</h2>
        <form class="row" (ngSubmit)="create()">
          <label>Código <input id="new-code" name="code" [(ngModel)]="draft.code" required></label>
          <label>Nombre <input id="new-name" class="wide" name="name" [(ngModel)]="draft.name" required></label>
          <label>Categoría
            <select name="category" [(ngModel)]="draft.category">
              <option>COLORACION</option><option>DECOLORACION</option><option>TRATAMIENTOS</option><option>CUIDADO</option>
            </select>
          </label>
          <label>Stock inicial <input id="new-stock" type="number" min="0" name="stock" [(ngModel)]="draft.initialStock"></label>
          <label>Stock mínimo <input id="new-minimum" type="number" min="0" name="minimum" [(ngModel)]="draft.minimumStock"></label>
          <label>Precio <input id="new-price" type="number" min="0" step="0.01" name="price" [(ngModel)]="draft.unitPrice"></label>
          <button class="primary" type="submit" id="create-item">Registrar</button>
        </form>
      </section>
    }
  `,
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly items = signal<InventoryItem[]>([]);
  readonly editing = signal<InventoryItem | null>(null);
  readonly error = signal('');
  readonly saved = signal('');
  minimum = 0;
  change = 0;
  reason = '';
  draft = emptyItem();

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { getAllInventory } = await this.api.gestion<{ getAllInventory: InventoryItem[] }>(`{ getAllInventory { ${FIELDS} } }`);
      this.items.set(getAllInventory);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  edit(item: InventoryItem): void {
    this.editing.set(item);
    this.minimum = item.minimumStock;
    this.change = 0;
    this.reason = '';
  }

  /** Ejecuta un cambio y recarga, para mostrar siempre lo que quedó guardado en el servidor. */
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

  async saveMinimum(item: InventoryItem): Promise<void> {
    await this.run(
      () => this.api.gestion('mutation ($id: ID!, $m: Int!) { updateMinimumStock(id: $id, minimumStock: $m) { id } }', { id: item.id, m: this.minimum }),
      'Stock mínimo actualizado.',
    );
  }

  async saveMovement(item: InventoryItem): Promise<void> {
    const saved = await this.run(
      () => this.api.gestion('mutation ($i: UpdateStockInput!) { updateStock(input: $i) { id } }', {
        i: { id: item.id, quantityChange: this.change, reason: this.reason },
      }),
      'Movimiento registrado.',
    );
    if (saved) {
      this.change = 0;
      this.reason = '';
    }
  }

  async create(): Promise<void> {
    const saved = await this.run(
      () => this.api.gestion('mutation ($i: CreateInventoryItemInput!) { createInventoryItem(input: $i) { id } }', { i: this.draft }),
      'Insumo registrado.',
    );
    if (saved) this.draft = emptyItem();
  }
}
