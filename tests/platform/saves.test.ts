import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSaveFile, parseSaveFile, simulationFromSave } from '../../src/platform/saveFormat';
import {
  ALL_SLOTS,
  deleteSlot,
  listSlots,
  readSlot,
  resetSaveDbConnection,
  writeSlot,
} from '../../src/platform/saves';
import { Simulation } from '../../src/sim/simulation';

beforeEach(async () => {
  for (const s of ALL_SLOTS) await deleteSlot(s);
  resetSaveDbConnection();
});

describe('IndexedDB save slots', () => {
  it('offers three manual slots and an autosave', async () => {
    const slots = await listSlots();
    expect(slots.map((s) => s.slot)).toEqual(['slot1', 'slot2', 'slot3', 'autosave']);
    expect(slots.every((s) => s.meta === null)).toBe(true);
  });

  it('writes, lists, reads back and deletes', async () => {
    const sim = Simulation.newGame({ seed: 11 });
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 1, y: 1 },
      to: { x: 9, y: 1 },
    });
    sim.step(100);
    await writeSlot('slot2', createSaveFile(sim, 'slot2'));
    const slots = await listSlots();
    expect(slots.find((s) => s.slot === 'slot2')?.meta?.seed).toBe(11);
    const loaded = simulationFromSave(parseSaveFile(await readSlot('slot2')));
    expect(loaded.hash()).toBe(sim.hash());
    await deleteSlot('slot2');
    expect(await readSlot('slot2')).toBeNull();
  });
});
