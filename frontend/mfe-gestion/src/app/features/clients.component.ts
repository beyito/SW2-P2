import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { messageOf } from '../core/config';
import { Client } from '../core/models';

const emptyDraft = () => ({ fullName: '', email: '', phone: '' });

/** Fichas de clientes del CRM, con sus puntos, y registro por el personal (CU-03, CU-12). */
@Component({
  selector: 'app-clients',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Registrar cliente</h2>
      <form class="row" (ngSubmit)="register()">
        <label>Nombre completo <input id="client-name" class="wide" name="fullName" [(ngModel)]="draft.fullName" required></label>
        <label>Correo <input id="client-email" type="email" name="email" [(ngModel)]="draft.email" required></label>
        <label>Teléfono <input id="client-phone" name="phone" [(ngModel)]="draft.phone" required></label>
        <button class="primary" type="submit" id="client-save">Registrar</button>
      </form>
      @if (error()) { <p class="error" role="alert" id="client-error">{{ error() }}</p> }
      @if (saved()) { <p class="success" role="status">{{ saved() }}</p> }
    </section>

    <section class="card">
      <h2>Clientes</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Puntos</th></tr></thead>
          <tbody>
            @for (client of clients(); track client.id) {
              <tr class="client-row" [attr.data-email]="client.email">
                <td>{{ client.fullName }}</td>
                <td>{{ client.email }}</td>
                <td>{{ client.phone }}</td>
                <td>{{ client.loyaltyPoints }}</td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="muted">No hay clientes registrados.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class ClientsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly clients = signal<Client[]>([]);
  readonly error = signal('');
  readonly saved = signal('');
  draft = emptyDraft();

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { getClients } = await this.api.crm<{ getClients: Client[] }>('{ getClients { id fullName email phone loyaltyPoints } }');
      this.clients.set(getClients);
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  async register(): Promise<void> {
    this.error.set('');
    this.saved.set('');
    try {
      await this.api.crm('mutation ($i: RegisterClientInput!) { registerClient(input: $i) { id } }', { i: this.draft });
      this.draft = emptyDraft();
      await this.load();
      this.saved.set('Cliente registrado.');
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }
}
