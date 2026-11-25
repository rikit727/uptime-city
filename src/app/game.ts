/**
 * Wires everything together: owns the current Simulation, the renderer, the
 * HUD, input and the frame loop. This is the only module that knows about all
 * layers; sim, render and ui stay independent of each other.
 */
import { GAME_NAME } from '../config';
import { GAME, Simulation } from '../sim';
import type { Command, DensityId, SimEvent, WeatherEventId } from '../sim';
import { GameRenderer } from '../render/renderer';
import type { OverlayId } from '../render/renderer';
import { downloadSave, pickSaveFileText } from '../platform/fileTransfer';
import { createSaveFile, parseSaveFile, simulationFromSave } from '../platform/saveFormat';
import { AUTOSAVE_SLOT, deleteSlot, listSlots, readSlot, writeSlot } from '../platform/saves';
import type { SlotId } from '../platform/saves';
import { loadSettings, saveSettings } from '../platform/settings';
import type { Settings } from '../platform/settings';
import { Hud, randomSeed } from '../ui/hud';
import type { UiActions } from '../ui/hud';
import { formatInt } from '../ui/format';
import { CREW_NAMES, formatDuration } from '../ui/inbox';
import { TOOLS } from '../ui/tools';
import type { ToolId } from '../ui/tools';
import { CameraInput } from './cameraInput';
import { TickScheduler } from './tickScheduler';
import { ToolController } from './toolController';

/** Sim time budget per frame, in milliseconds (see BUILD_PROMPT performance rules). */
const SIM_BUDGET_MS = 4;

const WEATHER_ADVICE: Record<WeatherEventId, string> = {
  heatwave: 'Expect high demand for cooling, water and irrigation.',
  coldSnap: 'Expect high heating demand.',
  storm: 'Wind turbines shut down in very strong wind, and sewers may overflow.',
};

export class Game {
  private sim: Simulation;
  private readonly renderer: GameRenderer;
  private readonly hud: Hud;
  private readonly cameraInput: CameraInput;
  private readonly tools: ToolController;
  private readonly scheduler = new TickScheduler();
  private readonly settings: Settings = loadSettings();
  private lastFrame = performance.now();

  constructor(container: HTMLElement) {
    this.sim = Simulation.newGame({ seed: randomSeed() });
    const canvas = document.createElement('canvas');
    canvas.className = 'view';
    container.append(canvas);
    const size = this.sim.state.world.width;
    this.renderer = new GameRenderer(canvas, size, this.sim.state.world.height);
    this.renderer.setShadows(this.settings.shadows);
    this.renderer.setGridVisible(this.settings.showGrid);
    this.hud = new Hud(this.actions());
    container.append(this.hud.root);
    this.cameraInput = new CameraInput(this.renderer.rig, canvas);
    this.cameraInput.edgeScroll = this.settings.edgeScroll;
    this.tools = new ToolController(() => this.sim, this.renderer, this.hud, this.cameraInput);
    this.tools.selectTool({ kind: 'inspect' });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.cameraInput.keyUp(e.code));
    document.title = GAME_NAME;
    if (!this.settings.seenHelp) this.hud.openHelp();
  }

  start(): void {
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.stepSim(dt);
      this.cameraInput.update(dt);
      const snap = this.sim.snapshot();
      this.renderer.setTimeScale(GAME.speeds[this.scheduler.speedIndex] ?? 1);
      this.renderer.render(snap, dt);
      this.hud.update(snap, this.scheduler.speedIndex);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private stepSim(dt: number): void {
    const due = this.scheduler.advance(dt);
    const t0 = performance.now();
    let ran = 0;
    while (ran < due && performance.now() - t0 < SIM_BUDGET_MS) {
      this.sim.step();
      ran++;
    }
    if (ran < due) this.scheduler.refund(due - ran);
    for (const ev of this.sim.drainEvents()) this.onSimEvent(ev);
  }

  private onSimEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'dayStarted':
        if (this.settings.autosave) void this.autosave();
        break;
      case 'weatherEventStarted':
        this.toast(`${ev.name} for the next ${ev.days} days. ${WEATHER_ADVICE[ev.event]}`, 'warn');
        break;
      case 'weatherEventEnded':
        this.toast(`The ${ev.name.toLowerCase()} is over.`);
        break;
      case 'powerShortfall':
        this.toast(
          `Power shortfall: rolling outages, ${ev.shedMW.toFixed(1)} MW short. Add generation, substations or stronger lines.`,
          'error',
        );
        break;
      case 'powerRestored':
        this.toast('Power supply restored across the city.', 'good');
        break;
      case 'waterSupplyLost':
        this.toast(
          `${formatInt(ev.buildings)} buildings have no water (${formatInt(ev.residents)} residents). Check treatment works, intakes, power and mains.`,
          'error',
        );
        break;
      case 'waterSupplyRestored':
        this.toast('Water supply restored to every customer.', 'good');
        break;
      case 'priorityCustomersWithoutWater':
        this.toast(
          `${ev.buildings === 1 ? 'A priority customer has' : `${ev.buildings} priority customers have`} lost water supply. Restore it urgently.`,
          'error',
        );
        break;
      case 'sewerOverflow':
        this.toast(
          `Storm overflow: sewage works overwhelmed, spilling ${Math.round(ev.spillLps)} l/s into the river.`,
          'warn',
        );
        break;
      case 'sewerOverflowEnded':
        this.toast(`Storm overflow stopped after spilling ${ev.spilledMl.toFixed(1)} Ml.`);
        break;
      case 'abstractionLicenceBreached':
        this.toast(
          `Abstraction licence breached: ${ev.usedMl.toFixed(1)} Ml taken today against ${ev.licenceMl} Ml licensed.`,
          'warn',
        );
        break;
      case 'incidentOpened':
        this.toast(
          `${ev.name} at ${ev.x}, ${ev.y}.${ev.severity >= 3 ? ' Serious: customers are affected.' : ''} Open the incident inbox (\`) for details.`,
          ev.severity >= 3 ? 'error' : ev.kind === 'roadDefect' ? 'info' : 'warn',
        );
        break;
      case 'incidentResolved':
        if (ev.outcome === 'repaired')
          this.toast(`${ev.name} repaired after ${formatDuration(ev.minutes)}.`, 'good');
        else if (ev.outcome === 'cleared') this.toast(`${ev.name} over.`, 'good');
        break;
      case 'slaBreached':
        this.toast(`${ev.name}: the repair target time has been missed.`, 'warn');
        break;
      case 'priorityCustomersAffected':
        this.toast(
          `${ev.name} has cut off ${ev.buildings === 1 ? 'a priority customer' : `${ev.buildings} priority customers`}.${ev.bottledWater ? ' Send bottled water from the incident inbox.' : ''}`,
          'error',
        );
        break;
      case 'maintenanceCompleted':
        this.toast(`${ev.name} finished at ${ev.x}, ${ev.y}.`, 'good');
        break;
      case 'noCrew':
        this.toast(
          `No ${CREW_NAMES[ev.crew].toLowerCase()} crew to send. Build a depot (Maintenance tools) so faults get fixed.`,
          'warn',
        );
        break;
      case 'permitClash':
        this.toast(
          `Street works clash at ${ev.x}, ${ev.y}: two permits overlap on the same street. Combine them in the incident inbox (\`).`,
          'warn',
        );
        break;
      case 'permitOverrun':
        this.toast(`Roadworks at ${ev.x}, ${ev.y} are overrunning their permit.`, 'warn');
        break;
      case 'irrigationLicenceReached':
        this.toast(
          `Farm irrigation licence used up (${ev.licenceMl} Ml today). Farms by the river switch to the mains or go without until midnight.`,
          'warn',
        );
        break;
      default:
        break;
    }
  }

  private async autosave(): Promise<void> {
    try {
      await writeSlot(AUTOSAVE_SLOT, createSaveFile(this.sim, 'Autosave'));
      this.hud.toasts.show('Autosaved.', 'info', 1800);
    } catch (e) {
      this.hud.toasts.show(`Autosave failed: ${(e as Error).message}`, 'error');
    }
  }

  /** Swap in a different simulation (new game or loaded save). */
  private replaceSim(sim: Simulation): void {
    this.tools.cancel();
    this.sim = sim;
    this.renderer.invalidate();
    this.hud.inspector.show(null);
  }

  private updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      void this.hud.openSaves();
      return;
    }
    if (e.code === 'Escape') {
      if (this.hud.modalOpen) this.hud.closeModal();
      else if (!this.tools.cancel()) this.tools.selectTool({ kind: 'inspect' });
      return;
    }
    if (this.hud.modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const shiftTool = e.shiftKey ? TOOLS.find((t) => t.shift && t.code === e.code) : undefined;
    if (shiftTool) {
      this.tools.selectTool(shiftTool.tool);
      return;
    }
    if (this.cameraInput.keyDown(e.code)) {
      e.preventDefault();
      return;
    }
    const tool = TOOLS.find((t) => !t.shift && t.code === e.code);
    if (tool) {
      this.tools.selectTool(tool.tool);
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.scheduler.togglePause();
        break;
      case 'Comma':
        this.scheduler.slower();
        break;
      case 'Period':
        this.scheduler.faster();
        break;
      case 'BracketLeft':
        this.tools.cycleDensity(-1);
        break;
      case 'BracketRight':
        this.tools.cycleDensity(1);
        break;
      case 'KeyG':
        this.updateSettings({ showGrid: !this.settings.showGrid });
        this.renderer.setGridVisible(this.settings.showGrid);
        break;
      case 'KeyH':
        this.hud.openHelp();
        break;
      case 'KeyO':
        this.cycleOverlay();
        break;
      case 'Backquote':
        this.hud.inbox.toggle();
        break;
    }
  }

  private actions(): UiActions {
    const toast = this.toast.bind(this);
    return {
      selectTool: (tool: ToolId) => this.tools.selectTool(tool),
      setDensity: (d: DensityId) => this.tools.setDensity(d),
      setSpeed: (i: number) => this.scheduler.setSpeed(i),
      listSaves: () => listSlots(),
      saveTo: async (slot: SlotId) => {
        try {
          await writeSlot(slot, createSaveFile(this.sim, slot));
          toast('City saved.', 'good');
        } catch (e) {
          toast(`Could not save: ${(e as Error).message}`, 'error');
        }
      },
      loadFrom: async (slot: SlotId) => {
        try {
          const raw = await readSlot(slot);
          if (!raw) throw new Error('That slot is empty.');
          this.replaceSim(simulationFromSave(parseSaveFile(raw)));
          toast('City loaded.', 'good');
        } catch (e) {
          toast(`Could not load: ${(e as Error).message}`, 'error');
        }
      },
      deleteSlot: async (slot: SlotId) => {
        try {
          await deleteSlot(slot);
          toast('Save deleted.');
        } catch (e) {
          toast(`Could not delete: ${(e as Error).message}`, 'error');
        }
      },
      exportSave: () => downloadSave(createSaveFile(this.sim, 'Export')),
      importSave: async () => {
        const text = await pickSaveFileText();
        if (text === null) return;
        try {
          this.replaceSim(simulationFromSave(parseSaveFile(text)));
          toast('Save imported.', 'good');
        } catch (e) {
          toast(`Could not import: ${(e as Error).message}`, 'error');
        }
      },
      newGame: (seed: number) => {
        this.replaceSim(Simulation.newGame({ seed, startingCash: GAME.startingCash }));
        toast(`New city started (seed ${seed}).`, 'good');
      },
      setGrid: (v: boolean) => {
        this.updateSettings({ showGrid: v });
        this.renderer.setGridVisible(v);
      },
      helpClosed: () => this.updateSettings({ seenHelp: true }),
      toggleOverlay: (id: 'water' | 'traffic') =>
        this.setOverlay(this.renderer.overlay === id ? 'none' : id),
      setWorksOptions: (patch) => this.tools.setWorksOptions(patch),
      dispatch: (cmd: Command) => {
        const r = this.sim.dispatch(cmd);
        if (!r.ok) toast(r.reason ?? 'That is not possible.', 'warn');
        else if (r.note) toast(r.note, 'good');
      },
      focusTile: (tile: number) => {
        const w = this.sim.state.world.width;
        const rig = this.renderer.rig;
        rig.target.set((tile % w) + 0.5, 0, Math.floor(tile / w) + 0.5);
        rig.distance = Math.min(rig.distance, 45);
        rig.apply();
        this.tools.selectTool({ kind: 'inspect' });
        this.hud.inspector.show(tile);
      },
      setThreshold: (below: number) => this.tools.setThreshold(below),
    };
  }

  private setOverlay(id: OverlayId): void {
    this.renderer.setOverlay(id);
    this.hud.setOverlay(id);
  }

  /** O: water pressure → traffic → none. */
  private cycleOverlay(): void {
    const order: OverlayId[] = ['none', 'water', 'traffic'];
    this.setOverlay(order[(order.indexOf(this.renderer.overlay) + 1) % order.length]!);
  }

  private toast(msg: string, kind: 'info' | 'good' | 'warn' | 'error' = 'info'): void {
    this.hud.toasts.show(msg, kind);
  }

  /** Debug/test hook: exposes the live sim on window in dev builds. */
  get debugSim(): Simulation {
    return this.sim;
  }
}
