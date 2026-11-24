import { h } from './dom';

export type ToastKind = 'info' | 'good' | 'warn' | 'error';

export class Toasts {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(message: string, kind: ToastKind = 'info', ms = 3500): void {
    const t = h('div', { class: `toast toast-${kind}` }, message);
    this.el.append(t);
    while (this.el.children.length > 5) this.el.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('toast-out');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }
}
