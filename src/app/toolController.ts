/**
 * Turns pointer input on the map into tool previews and sim commands.
 * The current tool and density live here; the HUD only displays them.
 */
import type { Command, DensityId, Simulation } from '../sim';
import type { GameRenderer } from '../render/renderer';
import type { Hud } from '../ui/hud';
import type { ToolId } from '../ui/tools';
import { formatMoney } from '../ui/format';
import type { CameraInput } from './cameraInput';

export class ToolController {
  tool: ToolId = { kind: 'inspect' };
  density: DensityId = 'low';
  private dragStart: number | null = null;
  private dragEnd: number | null = null;
  private pointerId: number | null = null;

  constructor(
    private readonly getSim: () => Simulation,
    private readonly renderer: GameRenderer,
    private readonly hud: Hud,
    private readonly camera: CameraInput,
  ) {
    const c = renderer.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => this.cancel());
    c.addEventListener('pointerleave', () => this.renderer.setCursor(null));
  }

  selectTool(tool: ToolId): void {
    this.cancel();
    this.tool = tool;
    this.hud.setActiveTool(tool, this.density);
    if (tool.kind !== 'inspect') this.hud.inspector.show(null);
    this.hud.setStatus(hintFor(tool));
  }

  setDensity(d: DensityId): void {
    this.density = d;
    this.hud.setActiveTool(this.tool, d);
    this.refreshPreview();
  }

  cycleDensity(step: number): void {
    const order: DensityId[] = ['low', 'medium', 'high'];
    const i = Math.max(0, Math.min(2, order.indexOf(this.density) + step));
    this.setDensity(order[i]!);
  }

  /** Cancel an in-progress drag. Returns true if there was one. */
  cancel(): boolean {
    const had = this.dragStart !== null;
    this.dragStart = this.dragEnd = null;
    this.pointerId = null;
    this.renderer.setPreview(null);
    if (had) this.hud.setStatus(hintFor(this.tool));
    return had;
  }

  private onDown(e: PointerEvent): void {
    if (this.camera.beginDrag(e)) {
      this.renderer.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const tile = this.renderer.pickTile(e.clientX, e.clientY);
    if (this.tool.kind === 'inspect') {
      // Left-drag with Inspect pans; a click without movement inspects.
      this.camera.beginDrag(e, true);
      this.renderer.canvas.setPointerCapture(e.pointerId);
      this.dragStart = tile;
      this.pointerId = e.pointerId;
      return;
    }
    if (tile === null) return;
    this.renderer.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.dragStart = this.dragEnd = tile;
    this.refreshPreview();
  }

  private onMove(e: PointerEvent): void {
    const tile = this.renderer.pickTile(e.clientX, e.clientY);
    this.renderer.setCursor(tile);
    if (this.camera.dragging) {
      this.camera.moveDrag(e);
      return;
    }
    this.camera.moveDrag(e); // tracks pointer for edge scroll
    if (this.dragStart === null || tile === null || tile === this.dragEnd) return;
    this.dragEnd = tile;
    this.refreshPreview();
  }

  private onUp(e: PointerEvent): void {
    if (this.camera.dragging) {
      this.camera.endDrag();
      if (this.tool.kind === 'inspect' && this.pointerId === e.pointerId) {
        const tile = this.renderer.pickTile(e.clientX, e.clientY);
        if (tile !== null && tile === this.dragStart) this.hud.inspector.show(tile);
        this.dragStart = null;
        this.pointerId = null;
      }
      return;
    }
    if (this.pointerId !== e.pointerId) return;
    const cmd = this.currentCommand();
    this.cancel();
    if (!cmd) return;
    const result = this.getSim().dispatch(cmd);
    if (!result.ok) this.hud.toasts.show(result.reason ?? 'That is not possible here.', 'warn');
  }

  private currentCommand(): Command | null {
    if (this.dragStart === null || this.dragEnd === null) return null;
    const w = this.getSim().state.world.width;
    const from = { x: this.dragStart % w, y: Math.floor(this.dragStart / w) };
    const to = { x: this.dragEnd % w, y: Math.floor(this.dragEnd / w) };
    switch (this.tool.kind) {
      case 'road':
        return { type: 'buildRoad', roadClass: this.tool.roadClass, from, to };
      case 'zone':
        return { type: 'zone', zone: this.tool.zone, density: this.density, from, to };
      case 'bulldoze':
        return { type: 'bulldoze', from, to };
      default:
        return null;
    }
  }

  private refreshPreview(): void {
    const cmd = this.currentCommand();
    if (!cmd) return;
    const plan = this.getSim().preview(cmd);
    this.renderer.setPreview({
      affected: plan.affected,
      blocked: plan.blocked,
      removing: cmd.type === 'bulldoze',
      invalid: !plan.ok && plan.affected.length > 0,
    });
    if (plan.ok) {
      const n = plan.affected.length;
      this.hud.setStatus(`${n} tile${n === 1 ? '' : 's'} · ${formatMoney(plan.cost)}`);
    } else {
      this.hud.setStatus(plan.reason ?? 'Not possible here.', 'error');
    }
  }
}

function hintFor(tool: ToolId): string {
  switch (tool.kind) {
    case 'inspect':
      return 'Click a tile to inspect it. Drag to pan.';
    case 'road':
      return 'Drag to lay a road. Release to build; Esc cancels.';
    case 'zone':
      return 'Drag a rectangle to zone land. Roads and water are skipped.';
    case 'bulldoze':
      return 'Drag a rectangle to clear roads and zoning.';
  }
}
