import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInput = vi.hoisted(() => vi.fn());

vi.mock("mediabunny", () => ({
  Input: mockInput,
  ALL_FORMATS: [],
  BlobSource: class {
    constructor(public blob: Blob) {}
  },
  CanvasSink: class {
    constructor(public track: unknown, public options: unknown) {}
  },
}));

import {
  acquireResource,
  clearCache,
  disposeResource,
  getOrCreateResources,
  releaseResource,
  type CachedResource,
} from "./decode-worker";

beforeEach(() => {
  clearCache();
  mockInput.mockReset();
  mockInput.mockImplementation(() => ({
    getPrimaryVideoTrack: vi.fn(async () => ({ id: "video-track" })),
    [Symbol.dispose]: vi.fn(),
  }));
});

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


describe("decode worker resource creation concurrency", () => {
  it("serializes concurrent replacements and shares the final matching resource", async () => {
    const originalBlob = new Blob(["original"]);
    const replacementBlob = new Blob(["replacement"]);

    const original = await getOrCreateResources(
      "clip-race", originalBlob, 640, 360,
    );
    expect(original).not.toBeNull();

    const firstReplacement = getOrCreateResources(
      "clip-race", replacementBlob, 640, 360,
    );
    const secondReplacement = getOrCreateResources(
      "clip-race", replacementBlob, 640, 360,
    );

    const [first, second] = await Promise.all([
      firstReplacement,
      secondReplacement,
    ]);

    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(first?.activeUses).toBe(2);

    if (original) releaseResource(original);
    if (first) {
      releaseResource(first);
      releaseResource(second!);
    }
    clearCache("clip-race");
  });

  it("returns a failed resource creation to every concurrent waiter", async () => {
    mockInput.mockImplementation(() => ({
      getPrimaryVideoTrack: vi.fn(async () => null),
      [Symbol.dispose]: vi.fn(),
    }));

    const blob = new Blob(["invalid-video"]);
    const [first, second] = await Promise.all([
      getOrCreateResources("clip-failure", blob, 320, 180),
      getOrCreateResources("clip-failure", blob, 320, 180),
    ]);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockInput).toHaveBeenCalledOnce();
  });

  it("does not repopulate the cache when cleared during resource creation", async () => {
    let resolveTrack!: (track: unknown) => void;
    const dispose = vi.fn();
    mockInput.mockImplementation(() => ({
      getPrimaryVideoTrack: () => new Promise((resolve) => {
        resolveTrack = resolve;
      }),
      [Symbol.dispose]: dispose,
    }));

    const pending = getOrCreateResources(
      "clip-clear-race", new Blob(["stale"]), 320, 180,
    );
    await vi.waitFor(() => expect(resolveTrack).toBeTypeOf("function"));

    clearCache("clip-clear-race");
    resolveTrack({ id: "late-track" });

    await expect(pending).resolves.toBeNull();
    expect(dispose).toHaveBeenCalledOnce();

    mockInput.mockImplementation(() => ({
      getPrimaryVideoTrack: vi.fn(async () => ({ id: "fresh-track" })),
      [Symbol.dispose]: vi.fn(),
    }));
    const fresh = await getOrCreateResources(
      "clip-clear-race", new Blob(["fresh"]), 320, 180,
    );
    expect(fresh).not.toBeNull();
    if (fresh) releaseResource(fresh);
    clearCache("clip-clear-race");
  });

  it("does not dispose an older resource until its active lease is released", async () => {
    const firstBlob = new Blob(["first"]);
    const secondBlob = new Blob(["second"]);
    const first = await getOrCreateResources("clip-lease", firstBlob, 320, 180);
    const second = await getOrCreateResources("clip-lease", secondBlob, 320, 180);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.disposePending).toBe(true);

    if (first) releaseResource(first);
    expect(first?.disposePending).toBe(false);
    if (second) releaseResource(second);
    clearCache("clip-lease");
  });
});
