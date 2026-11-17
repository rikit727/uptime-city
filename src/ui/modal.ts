import { h } from './dom';

/** A simple modal dialog. Only one is open at a time (see Hud). */
export class Modal {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;

  constructor(onClose: () => void) {
    this.titleEl = h('h2');
    this.body = h('div', { class: 'modal-body' });
    const close = h('button', { class: 'modal-close', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', onClose);
    const panel = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, this.titleEl, close),
      this.body,
    );
    this.el = h('div', { class: 'modal-backdrop hidden' }, panel);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) onClose();
    });
  }

  open(title: string): HTMLDivElement {
    this.titleEl.textContent = title;
    this.el.classList.remove('hidden');
    return this.body;
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
