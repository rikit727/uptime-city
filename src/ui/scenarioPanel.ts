/**
 * The scenario box (bottom left, in a scenario only): name, time left, each
 * objective with its status (icon and word, never colour alone), value and
 * target, and the score so far. Shift+G folds it. Reads the snapshot only.
 */
import { scenarioDef } from '../sim';
import type { ObjectiveStatus, SimSnapshot } from '../sim';
import { clear, h } from './dom';
import { formatDuration } from './inbox';

const STATUS: Record<ObjectiveStatus, { icon: string; word: string }> = {
  onTrack: { icon: '●', word: 'On track' },
  atRisk: { icon: '▲', word: 'At risk' },
  met: { icon: '✔', word: 'Met' },
  failed: { icon: '✘', word: 'Failed' },
};

export class ScenarioPanel {
  readonly el = h('aside', { class: 'panel scenario-panel hidden', 'aria-label': 'Scenario' });
  private key = '';
  private folded = false;

  constructor(private readonly onBriefing: (id: string) => void) {}

  toggleFold(): void {
    this.folded = !this.folded;
    this.key = '';
  }

  update(snap: SimSnapshot): void {
    const sc = snap.scenario;
    this.el.classList.toggle('hidden', !sc);
    if (!sc) return;
    const key = `${sc.id}:${Math.floor(snap.minute / 5)}:${sc.status}:${sc.eventsDone}:${this.folded}`;
    if (key === this.key) return;
    this.key = key;
    const def = scenarioDef(sc.id);
    const el = this.el;
    clear(el);
    const fold = h('button', { class: 'close', title: 'Fold (Shift+G)' }, this.folded ? '▸' : '▾');
    fold.addEventListener('click', () => {
      this.toggleFold();
      this.update(snap);
    });
    const left =
      sc.status === 'running'
        ? `${formatDuration(sc.endMinute - snap.minute)} left`
        : sc.status === 'won'
          ? 'Won'
          : 'Over';
    const { score, max } = snap.city.score();
    el.append(
      h('div', { class: 'inbox-head' }, h('h3', {}, def.name), fold),
      h('div', { class: 'muted' }, `${left} · score ${score} / ${max}`),
    );
    if (this.folded) return;
    const list = h('ul', { class: 'objectives' });
    for (const v of snap.city.objectives()) {
      const st = STATUS[v.status];
      list.append(
        h(
          'li',
          { class: `objective ${v.status}` },
          h('span', { class: 'obj-icon', 'aria-hidden': 'true' }, st.icon),
          h(
            'div',
            {},
            h('div', {}, h('strong', {}, v.label), h('span', { class: 'muted' }, ` · ${st.word}`)),
            h('div', { class: 'muted' }, `${v.value} · target ${v.target}`),
          ),
        ),
      );
    }
    const brief = h('button', { class: 'small' }, 'Briefing');
    brief.addEventListener('click', () => this.onBriefing(sc.id));
    el.append(list, h('div', { class: 'row' }, brief));
  }
}
