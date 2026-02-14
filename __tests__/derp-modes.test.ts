import { expect, test } from 'bun:test';
import { createDerpManager, type DerpNode } from '../src/derp-manager';

const SELF_NODE: DerpNode = {
  id: 'self-1',
  regionId: 1,
  name: 'relay-self-1',
  hostName: 'self-1.mesh.local',
  ipv4: '10.0.0.1',
  stunPort: 3478,
  derpPort: 443,
};

const PUBLIC_NODE: DerpNode = {
  id: 'public-1',
  regionId: 2,
  name: 'relay-public-1',
  hostName: 'public-1.mesh.example',
  ipv4: '203.0.113.10',
  stunPort: 3478,
  derpPort: 443,
};

test('derp manager supports self-hosted-only mode', async (): Promise<void> => {
  const manager = createDerpManager({
    config: {
      mode: 'self-hosted-only',
      selfHostedNodes: [SELF_NODE],
    },
  });

  const map = await manager.buildDerpMap();
  expect(Object.keys(map.Regions)).toEqual(['1']);
  expect(map.Regions['1']?.Nodes).toHaveLength(1);
});

test('derp manager supports public-only mode from inline config', async (): Promise<void> => {
  const manager = createDerpManager({
    config: {
      mode: 'public-only',
      selfHostedNodes: [SELF_NODE],
      publicNodes: [PUBLIC_NODE],
    },
  });

  const map = await manager.buildDerpMap();
  expect(Object.keys(map.Regions)).toEqual(['2']);
  expect(map.Regions['2']?.Nodes[0]?.HostName).toBe('public-1.mesh.example');
});

test('derp manager supports hybrid mode from file source', async (): Promise<void> => {
  const manager = createDerpManager({
    config: {
      mode: 'hybrid',
      selfHostedNodes: [SELF_NODE],
      publicNodesPath: '/tmp/public-derp.json',
    },
    readText: async () => JSON.stringify({ nodes: [PUBLIC_NODE] }),
  });

  const map = await manager.buildDerpMap();
  expect(Object.keys(map.Regions).sort()).toEqual(['1', '2']);
});

test('derp manager fails fast when public source missing', async (): Promise<void> => {
  const manager = createDerpManager({
    config: {
      mode: 'public-only',
      selfHostedNodes: [SELF_NODE],
    },
  });

  await expect(manager.buildDerpMap()).rejects.toThrow('public-only mode requires non-empty public DERP source');
});

test('derp manager applies cooldown when switching relay nodes', async (): Promise<void> => {
  let currentTs = 1_000;

  const manager = createDerpManager({
    config: {
      mode: 'hybrid',
      selfHostedNodes: [SELF_NODE],
      publicNodes: [PUBLIC_NODE],
      cooldownMs: 100,
    },
    now: () => currentTs,
  });

  const first = await manager.selectRelayNode({
    [PUBLIC_NODE.id]: 100,
    [SELF_NODE.id]: 20,
  });
  expect(first?.id).toBe('self-1');

  currentTs = 1_050;
  const second = await manager.selectRelayNode({
    [PUBLIC_NODE.id]: 5,
    [SELF_NODE.id]: 80,
  });
  expect(second?.id).toBe('self-1');

  currentTs = 1_200;
  const third = await manager.selectRelayNode({
    [PUBLIC_NODE.id]: 5,
    [SELF_NODE.id]: 80,
  });
  expect(third?.id).toBe('public-1');
});
