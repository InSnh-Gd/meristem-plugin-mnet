import { expect, test } from 'bun:test';
import { createHeadscaleManager, type HeadscaleProcess } from '../src/headscale-manager';

const createProcess = (): {
  process: HeadscaleProcess;
  emitExit: (code: number | null) => void;
  signals: string[];
} => {
  let exitHandler: ((code: number | null) => void) | null = null;
  const signals: string[] = [];

  return {
    process: {
      pid: 100,
      kill: (signal) => {
        signals.push(signal ?? 'SIGTERM');
      },
      onExit: (handler) => {
        exitHandler = handler;
      },
    },
    emitExit: (code) => {
      exitHandler?.(code);
    },
    signals,
  };
};

test('headscale manager starts and probes compatible version', async (): Promise<void> => {
  const spawned: string[] = [];
  const runtime = createProcess();

  const manager = createHeadscaleManager({
    binaryPath: 'headscale',
    configPath: '/tmp/headscale.yaml',
    apiUrl: 'http://localhost:8079',
    apiKey: 'test-key',
    processFactory: () => {
      spawned.push('spawned');
      return runtime.process;
    },
    client: {
      probeVersion: async () => ({ compatible: true, version: 'v0.24.1' }),
      healthCheck: async () => true,
      createAuthKey: async () => ({}),
      listMachines: async () => [],
      updateAcl: async () => ({}),
    },
  });

  const status = await manager.start();
  expect(spawned).toHaveLength(1);
  expect(status.running).toBe(true);
  expect(status.compatible).toBe(true);
});

test('headscale manager refuses incompatible version', async (): Promise<void> => {
  const manager = createHeadscaleManager({
    binaryPath: 'headscale',
    configPath: '/tmp/headscale.yaml',
    apiUrl: 'http://localhost:8079',
    apiKey: 'test-key',
    processFactory: () => createProcess().process,
    client: {
      probeVersion: async () => ({ compatible: false, version: 'v0.23.0' }),
      healthCheck: async () => true,
      createAuthKey: async () => ({}),
      listMachines: async () => [],
      updateAcl: async () => ({}),
    },
  });

  await expect(manager.start()).rejects.toThrow('Incompatible Headscale version');
});

test('headscale manager restarts up to max restarts', async (): Promise<void> => {
  const runtimes = [createProcess(), createProcess(), createProcess(), createProcess()];
  let index = 0;

  const manager = createHeadscaleManager({
    binaryPath: 'headscale',
    configPath: '/tmp/headscale.yaml',
    apiUrl: 'http://localhost:8079',
    apiKey: 'test-key',
    maxRestarts: 3,
    processFactory: () => {
      const runtime = runtimes[index] ?? runtimes[runtimes.length - 1];
      index += 1;
      return runtime.process;
    },
    client: {
      probeVersion: async () => ({ compatible: true, version: 'v0.24.1' }),
      healthCheck: async () => true,
      createAuthKey: async () => ({}),
      listMachines: async () => [],
      updateAcl: async () => ({}),
    },
  });

  await manager.start();
  runtimes[0].emitExit(1);
  runtimes[1].emitExit(1);
  runtimes[2].emitExit(1);
  runtimes[3].emitExit(1);

  expect(manager.getStatus().restartCount).toBe(3);
});

test('headscale manager reload sends SIGHUP', async (): Promise<void> => {
  const runtime = createProcess();

  const manager = createHeadscaleManager({
    binaryPath: 'headscale',
    configPath: '/tmp/headscale.yaml',
    apiUrl: 'http://localhost:8079',
    apiKey: 'test-key',
    processFactory: () => runtime.process,
    client: {
      probeVersion: async () => ({ compatible: true, version: 'v0.24.1' }),
      healthCheck: async () => true,
      createAuthKey: async () => ({}),
      listMachines: async () => [],
      updateAcl: async () => ({}),
    },
  });

  await manager.start();
  manager.reloadConfig();
  manager.stop();

  expect(runtime.signals).toContain('SIGHUP');
  expect(runtime.signals).toContain('SIGTERM');
});
