export type DerpMode = 'self-hosted-only' | 'public-only' | 'hybrid';

export type DerpNode = Readonly<{
  id: string;
  regionId: number;
  name: string;
  hostName: string;
  ipv4?: string;
  stunPort: number;
  derpPort: number;
}>;

export type DerpRegion = Readonly<{
  RegionID: number;
  RegionCode: string;
  Nodes: ReadonlyArray<{
    Name: string;
    RegionID: number;
    HostName: string;
    IPv4?: string;
    STUNPort: number;
    RelayPort: number;
  }>;
}>;

export type DerpMap = Readonly<{
  Regions: Record<string, DerpRegion>;
}>;

export type DerpConfig = Readonly<{
  mode: DerpMode;
  selfHostedNodes: DerpNode[];
  publicNodes?: DerpNode[];
  publicNodesPath?: string;
  cooldownMs?: number;
}>;

type DerpManagerOptions = Readonly<{
  config: DerpConfig;
  readText?: (path: string) => Promise<string>;
  now?: () => number;
}>;

const DEFAULT_COOLDOWN_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseNode = (value: unknown): DerpNode | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : null;
  const regionId = typeof value.regionId === 'number' ? value.regionId : null;
  const name = typeof value.name === 'string' ? value.name : null;
  const hostName = typeof value.hostName === 'string' ? value.hostName : null;
  const stunPort = typeof value.stunPort === 'number' ? value.stunPort : null;
  const derpPort = typeof value.derpPort === 'number' ? value.derpPort : null;

  if (!id || regionId === null || !name || !hostName || stunPort === null || derpPort === null) {
    return null;
  }

  return {
    id,
    regionId,
    name,
    hostName,
    ipv4: typeof value.ipv4 === 'string' ? value.ipv4 : undefined,
    stunPort,
    derpPort,
  };
};

const parseNodesFromJson = (raw: string): DerpNode[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid public DERP config JSON');
  }

  const source = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.nodes)
      ? parsed.nodes
      : null;

  if (!source) {
    throw new Error('Public DERP config must be an array or { nodes: [] }');
  }

  const nodes: DerpNode[] = [];
  for (const item of source) {
    const node = parseNode(item);
    if (!node) {
      throw new Error('Public DERP config contains invalid node item');
    }
    nodes.push(node);
  }

  return nodes;
};

const defaultReadText = async (path: string): Promise<string> => readFile(path, 'utf-8');

const dedupeNodes = (nodes: readonly DerpNode[]): DerpNode[] => {
  const byId = new Map<string, DerpNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
};

const groupNodesAsDerpMap = (nodes: readonly DerpNode[]): DerpMap => {
  const regions: Record<string, DerpRegion> = {};

  for (const node of nodes) {
    const key = String(node.regionId);
    const existing = regions[key];
    if (!existing) {
      regions[key] = {
        RegionID: node.regionId,
        RegionCode: `region-${node.regionId}`,
        Nodes: [
          {
            Name: node.name,
            RegionID: node.regionId,
            HostName: node.hostName,
            IPv4: node.ipv4,
            STUNPort: node.stunPort,
            RelayPort: node.derpPort,
          },
        ],
      };
      continue;
    }

    regions[key] = {
      ...existing,
      Nodes: [
        ...existing.Nodes,
        {
          Name: node.name,
          RegionID: node.regionId,
          HostName: node.hostName,
          IPv4: node.ipv4,
          STUNPort: node.stunPort,
          RelayPort: node.derpPort,
        },
      ],
    };
  }

  return {
    Regions: regions,
  };
};

const sortByLatency = (
  nodes: readonly DerpNode[],
  metrics: Readonly<Record<string, number>>,
): DerpNode[] =>
  [...nodes].sort((left, right) => {
    const leftLatency = metrics[left.id] ?? Number.MAX_SAFE_INTEGER;
    const rightLatency = metrics[right.id] ?? Number.MAX_SAFE_INTEGER;
    return leftLatency - rightLatency;
  });

export const createDerpManager = (options: DerpManagerOptions) => {
  const readText = options.readText ?? defaultReadText;
  const now = options.now ?? (() => Date.now());
  const cooldownMs =
    typeof options.config.cooldownMs === 'number' && options.config.cooldownMs > 0
      ? Math.floor(options.config.cooldownMs)
      : DEFAULT_COOLDOWN_MS;

  let activeNodeId: string | null = null;
  let lastSwitchAt = 0;

  const loadPublicNodes = async (): Promise<DerpNode[]> => {
    if (Array.isArray(options.config.publicNodes) && options.config.publicNodes.length > 0) {
      return dedupeNodes(options.config.publicNodes);
    }

    if (typeof options.config.publicNodesPath === 'string' && options.config.publicNodesPath.length > 0) {
      const raw = await readText(options.config.publicNodesPath);
      return dedupeNodes(parseNodesFromJson(raw));
    }

    return [];
  };

  const resolveNodesByMode = async (): Promise<DerpNode[]> => {
    const selfHosted = dedupeNodes(options.config.selfHostedNodes);
    const publicNodes = await loadPublicNodes();

    if (options.config.mode === 'self-hosted-only') {
      return selfHosted;
    }

    if (options.config.mode === 'public-only') {
      if (publicNodes.length === 0) {
        throw new Error('public-only mode requires non-empty public DERP source');
      }
      return publicNodes;
    }

    if (publicNodes.length === 0) {
      throw new Error('hybrid mode requires non-empty public DERP source');
    }

    return dedupeNodes([...selfHosted, ...publicNodes]);
  };

  return Object.freeze({
    buildDerpMap: async (): Promise<DerpMap> => {
      const nodes = await resolveNodesByMode();
      return groupNodesAsDerpMap(nodes);
    },
    selectRelayNode: async (latencyMetrics: Readonly<Record<string, number>>): Promise<DerpNode | null> => {
      const nodes = await resolveNodesByMode();
      if (nodes.length === 0) {
        return null;
      }

      const ordered = sortByLatency(nodes, latencyMetrics);
      const next = ordered[0];
      if (!next) {
        return null;
      }

      const currentTs = now();
      if (activeNodeId && activeNodeId !== next.id && currentTs - lastSwitchAt < cooldownMs) {
        const current = nodes.find((item) => item.id === activeNodeId);
        if (current) {
          return current;
        }
      }

      if (activeNodeId !== next.id) {
        activeNodeId = next.id;
        lastSwitchAt = currentTs;
      }

      return next;
    },
  });
};
import { readFile } from 'node:fs/promises';
