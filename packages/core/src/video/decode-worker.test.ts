import { describe, expect, it, vi } from "vitest";
import {
  acquireResource,
  disposeResource,
  releaseResource,
  type CachedResource,
} from "./decode-worker";

function createResource(): CachedResource & {
  input: { [Symbol.dispose]: ReturnType<typeof vi.fn> };
} {
  return {
    input: { [Symbol.dispose]: vi.fn() },
    sink: {},
    videoTrack: {},
    blob: new Blob(["video"]),
    width: 640,
    height: 360,
    activeUses: 0,
    disposePending: false,
  };
}

describe("decode worker resource leases", () => {
  it("defers disposal until the active decode releases its resource", () => {
    const resource = createResource();

    expect(acquireResource(resource)).toBe(resource);
    disposeResource(resource);

    expect(resource.activeUses).toBe(1);
    expect(resource.disposePending).toBe(true);
    expect(resource.input[Symbol.dispose]).not.toHaveBeenCalled();

    releaseResource(resource);

    expect(resource.activeUses).toBe(0);
    expect(resource.disposePending).toBe(false);
    expect(resource.input[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("waits for every concurrent decode lease before disposing", () => {
    const resource = createResource();

    acquireResource(resource);
    acquireResource(resource);
    disposeResource(resource);

    releaseResource(resource);
    expect(resource.activeUses).toBe(1);
    expect(resource.input[Symbol.dispose]).not.toHaveBeenCalled();

    releaseResource(resource);
    expect(resource.activeUses).toBe(0);
    expect(resource.input[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("disposes immediately when a resource has no active users", () => {
    const resource = createResource();

    disposeResource(resource);

    expect(resource.disposePending).toBe(false);
    expect(resource.input[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it("does not dispose a leased resource twice when releases are repeated", () => {
    const resource = createResource();

    acquireResource(resource);
    disposeResource(resource);
    releaseResource(resource);
    releaseResource(resource);

    expect(resource.activeUses).toBe(0);
    expect(resource.input[Symbol.dispose]).toHaveBeenCalledOnce();
  });
});
