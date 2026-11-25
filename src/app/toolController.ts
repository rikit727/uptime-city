/**
 * Turns pointer input on the map into tool previews and sim commands.
 * The current tool and density live here; the HUD only displays them.
 */
import { facilityDef } from '../sim';
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
  /** Facility tool: the tile under the pointer, for the placement preview. */
  private hover: number | null = null;

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
    c.addEventListener('pointerleave', () => {
      this.renderer.setCursor(null);
      if (this.tool.kind === 'facility' && this.dragStart === null) {
        this.hover = null;
        this.renderer.setPreview(null);
      }
    });
  }

  selectTool(tool: ToolId): void {
    this.cancel();
    this.tool = tool;
    this.hover = null;
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
    if (this.tool.kind === 'facility') {
      if (tile !== null && tile !== this.hover) {
        this.hover = tile;
        if (this.dragStart !== null) this.dragEnd = tile;
        this.refreshPreview();
      }
      return;
    }
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
    if (this.tool.kind === 'facility') this.refreshPreview();
  }

  private currentCommand(): Command | null {
    const w = this.getSim().state.world.width;
    if (this.tool.kind === 'facility') {
      const tile = this.dragEnd ?? this.hover;
      if (tile === null) return null;
      // The pointer marks the footprint's centre.
      const [fw, fd] = facilityDef(this.tool.facility).footprint;
      const at = { x: (tile % w) - ((fw - 1) >> 1), y: Math.floor(tile / w) - ((fd - 1) >> 1) };
      return { type: 'placeFacility', facility: this.tool.facility, at };
    }
    if (this.dragStart === null || this.dragEnd === null) return null;
    const from = { x: this.dragStart % w, y: Math.floor(this.dragStart / w) };
    const to = { x: this.dragEnd % w, y: Math.floor(this.dragEnd / w) };
    switch (this.tool.kind) {
      case 'road':
        return { type: 'buildRoad', roadClass: this.tool.roadClass, from, to };
      case 'zone':
        return { type: 'zone', zone: this.tool.zone, density: this.density, from, to };
      case 'line':
        return { type: 'buildLine', line: this.tool.line, from, to };
      case 'main':
        return { type: 'buildMain', main: this.tool.main, from, to };
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
      removed: plan.removed,
      removing: cmd.type === 'bulldoze',
      invalid: !plan.ok && plan.affected.length > 0,
    });
    if (plan.ok) {
      const n = plan.affected.length;
      const d = plan.demolish.length;
      const parts =
        cmd.type === 'placeFacility'
          ? [facilityDef(cmd.facility).name, formatMoney(plan.cost)]
          : [`${n} tile${n === 1 ? '' : 's'}`, formatMoney(plan.cost)];
      if (d > 0) parts.push(`demolishes ${d} building${d === 1 ? '' : 's'}`);
      this.hud.setStatus(parts.join(' · '));
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
    case 'line':
      return 'Drag to run a power line from a power station or another line to a substation.';
    case 'main':
      return 'Drag to lay or upgrade a water main. Roads already carry a 150 mm main.';
    case 'facility': {
      const def = facilityDef(tool.facility);
      const name = def.name.toLowerCase();
      if (def.utility === 'power') return `Click to place a ${name}. Connect it with power lines.`;
      if (def.kind === 'intake') return 'Click on the riverbank to place a river intake.';
      if (def.kind === 'sewage')
        return 'Click beside a road to place a sewage treatment works. Sewers run under every road.';
      return `Click beside a road or main to place a ${name}. It needs power to run.`;
    }
    case 'bulldoze':
      return 'Drag a rectangle to clear roads, lines, buildings and zoning.';
  }
}
