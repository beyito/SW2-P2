import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { CONFIG, messageOf } from '../core/config';
import { CommunityPost } from '../core/models';

/** Cola de publicaciones denunciadas u ocultas de la comunidad. */
@Component({
  selector: 'app-moderation',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Moderación de la comunidad</h2>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

      @for (post of queue(); track post.id) {
        <div class="row moderation-item" [attr.data-title]="post.title" style="align-items: flex-start; margin-bottom: 14px;">
          <img class="thumb" [src]="imageOf(post)" alt="">
          <div style="flex: 1; min-width: 200px;">
            <strong>{{ post.title }}</strong>
            <span class="badge" [class.bad]="post.status === 'HIDDEN'">{{ post.status === 'HIDDEN' ? 'Oculta' : 'Visible' }}</span>
            <div class="muted">Por {{ post.authorName }}: {{ post.description }}</div>
            @if (post.moderationReason) { <div class="muted">Motivo: {{ post.moderationReason }}</div> }
            @for (report of post.reports ?? []; track $index) {
              <div class="error">Denuncia: {{ report.reason }}</div>
            }
          </div>
          <div class="row">
            @if (post.status === 'VISIBLE') {
              <input class="mod-reason" placeholder="Motivo para ocultar" [name]="'reason-' + post.id" [(ngModel)]="reasons[post.id]">
              <button type="button" class="danger btn-hide" (click)="hide(post)">Ocultar</button>
            }
            <button type="button" class="secondary btn-restore" (click)="restore(post)">
              {{ post.status === 'HIDDEN' ? 'Restaurar' : 'Descartar denuncias' }}
            </button>
            <button type="button" class="danger btn-delete" (click)="remove(post)">Eliminar</button>
          </div>
        </div>
      } @empty {
        <p class="muted" id="moderation-empty">No hay publicaciones por revisar.</p>
      }
    </section>
  `,
})
export class ModerationComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly queue = signal<CommunityPost[]>([]);
  readonly error = signal('');
  reasons: Record<string, string> = {};

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.queue.set(await this.api.asesoria<CommunityPost[]>('/community/moderation/queue'));
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  imageOf(post: CommunityPost): string {
    return post.imageUrl.startsWith('/media/') ? `${CONFIG.asesoriaUrl}${post.imageUrl}` : post.imageUrl;
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set('');
    try {
      await action();
      await this.load();
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  hide(post: CommunityPost): Promise<void> {
    return this.run(() => this.api.asesoria(`/community/${post.id}/hide`, 'POST', { reason: this.reasons[post.id] ?? '' }));
  }

  restore(post: CommunityPost): Promise<void> {
    return this.run(() => this.api.asesoria(`/community/${post.id}/restore`, 'POST', {}));
  }

  remove(post: CommunityPost): Promise<void> {
    return this.run(() => this.api.asesoria(`/community/${post.id}`, 'DELETE'));
  }
}
