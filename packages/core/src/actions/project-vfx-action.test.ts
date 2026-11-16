import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { ActionExecutor } from "./action-executor";

function createProject(): Project {
  return {
    name: "VFX action test",
    modifiedAt: 0,
    settings: {},
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [],
      lightningEffects: [],
      particleEffects: [],
      markers: [],
    },
  } as unknown as Project;
}

function action(id: string, params: Record<string, unknown>) {
  return {
    type: "project/updateTimelineVfx",
    id,
    timestamp: Date.now(),
    params,
  };
}

describe("project/updateTimelineVfx", () => {
  it("updates particle effects and restores the previous collection on undo/redo", async () => {
    const project = createProject();
    const executor = new ActionExecutor();
    const particle = { id: "particle-1", startTime: 2, duration: 3 };

    const result = await executor.execute(
      action("add-particle-vfx", { particleEffects: [particle] }),
      project,
    );

    expect(result.success).toBe(true);
    expect(project.timeline.particleEffects).toEqual([particle]);

    const undo = await executor.undo(project);
    expect(undo.success).toBe(true);
    expect(project.timeline.particleEffects).toEqual([]);

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.particleEffects).toEqual([particle]);
  });

  it("undoes a grouped sequence of VFX timeline edits as one operation", async () => {
    const project = createProject();
    const executor = new ActionExecutor();
    executor.getHistory().beginGroup("Add and adjust VFX");

    await executor.execute(
      action("add-lightning", {
        lightningEffects: [{ id: "lightning-1", startTime: 1, duration: 1 }],
      }),
      project,
    );
    await executor.execute(
      action("move-lightning", {
        lightningEffects: [{ id: "lightning-1", startTime: 4, duration: 1 }],
      }),
      project,
    );
    executor.getHistory().endGroup();

    expect(project.timeline.lightningEffects?.[0]).toMatchObject({ startTime: 4 });
    const undo = await executor.undo(project);

    expect(undo.success).toBe(true);
    expect(project.timeline.lightningEffects).toEqual([]);
  });
});
