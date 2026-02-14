import { createHeadscaleManager } from './headscale-manager';
import { createDerpManager, type DerpMode, type DerpNode } from './derp-manager';

enum PluginMessageType {
  INIT = 'INIT',
  INVOKE = 'INVOKE',
  INVOKE_RESULT = 'INVOKE_RESULT',
  HEALTH = 'HEALTH',
}

type PluginHealthReport = {
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  uptime: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
};

type PluginInvokeRequest = {
  method: string;
  params: unknown;
  timeout?: number;
};

type PluginInvokeResponse = {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

type PluginMessage = {
  id: string;
  type: PluginMessageType;
  pluginId: string;
  timestamp: number;
  payload?: unknown;
  traceId?: string;
};

type RuntimeConfig = {
  binaryPath: string;
  configPath: string;
  apiUrl: string;
  apiKey: string;
  derpMode: DerpMode;
  derpSelfHosted: DerpNode[];
  derpPublic: DerpNode[];
  derpPublicPath?: string;
};

type RuntimeState = {
  pluginId: string;
  started: boolean;
  config: RuntimeConfig;
  manager: ReturnType<typeof createHeadscaleManager> | null;
  derpManager: ReturnType<typeof createDerpManager> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPluginMessage = (value: unknown): value is PluginMessage => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.pluginId === 'string' &&
    typeof value.type === 'string' &&
    typeof value.timestamp === 'number'
  );
};

const isInvokeRequest = (value: unknown): value is PluginInvokeRequest => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.method === 'string' && 'params' in value;
};

const readString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const readDerpMode = (value: unknown): DerpMode => {
  if (value === 'self-hosted-only' || value === 'public-only' || value === 'hybrid') {
    return value;
  }

  return 'hybrid';
};

const readDerpNodes = (value: unknown): DerpNode[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes: DerpNode[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const raw = item as Record<string, unknown>;
    if (
      typeof raw.id !== 'string' ||
      typeof raw.regionId !== 'number' ||
      typeof raw.name !== 'string' ||
      typeof raw.hostName !== 'string' ||
      typeof raw.stunPort !== 'number' ||
      typeof raw.derpPort !== 'number'
    ) {
      continue;
    }

    nodes.push({
      id: raw.id,
      regionId: raw.regionId,
      name: raw.name,
      hostName: raw.hostName,
      ipv4: typeof raw.ipv4 === 'string' ? raw.ipv4 : undefined,
      stunPort: raw.stunPort,
      derpPort: raw.derpPort,
    });
  }

  return nodes;
};

const DEFAULT_CONFIG: RuntimeConfig = {
  binaryPath: process.env.MERISTEM_MNET_HEADSCALE_BIN ?? 'headscale',
  configPath: process.env.MERISTEM_MNET_HEADSCALE_CONFIG ?? './data/mnet/headscale.yaml',
  apiUrl: process.env.MERISTEM_MNET_HEADSCALE_API_URL ?? 'http://localhost:8079',
  apiKey: process.env.MERISTEM_MNET_HEADSCALE_API_KEY ?? 'mnet-dev-key',
  derpMode: 'hybrid',
  derpSelfHosted: [],
  derpPublic: [],
  derpPublicPath: process.env.MERISTEM_MNET_DERP_PUBLIC_PATH,
};

const state: RuntimeState = {
  pluginId: 'com.meristem.mnet',
  started: false,
  config: DEFAULT_CONFIG,
  manager: null,
  derpManager: null,
};

const createManager = () => {
  state.manager = createHeadscaleManager({
    binaryPath: state.config.binaryPath,
    configPath: state.config.configPath,
    apiUrl: state.config.apiUrl,
    apiKey: state.config.apiKey,
  });

  state.derpManager = createDerpManager({
    config: {
      mode: state.config.derpMode,
      selfHostedNodes: state.config.derpSelfHosted,
      publicNodes: state.config.derpPublic,
      publicNodesPath: state.config.derpPublicPath,
    },
  });
};

const emitHealth = (status: PluginHealthReport['status']): void => {
  const usage = process.memoryUsage();
  const payload: PluginMessage = {
    id: crypto.randomUUID(),
    type: PluginMessageType.HEALTH,
    pluginId: state.pluginId,
    timestamp: Date.now(),
    payload: {
      memoryUsage: usage,
      uptime: process.uptime(),
      status,
    } satisfies PluginHealthReport,
  };
  globalThis.postMessage(payload);
};

const onInit = async (params: unknown): Promise<{ hook: string; config: RuntimeConfig }> => {
  const payload = isRecord(params) && isRecord(params.config) ? params.config : {};

  state.config = {
    binaryPath: readString(payload.binaryPath, DEFAULT_CONFIG.binaryPath),
    configPath: readString(payload.configPath, DEFAULT_CONFIG.configPath),
    apiUrl: readString(payload.apiUrl, DEFAULT_CONFIG.apiUrl),
    apiKey: readString(payload.apiKey, DEFAULT_CONFIG.apiKey),
    derpMode: readDerpMode(payload.derpMode),
    derpSelfHosted: readDerpNodes(payload.derpSelfHosted),
    derpPublic: readDerpNodes(payload.derpPublic),
    derpPublicPath: readString(payload.derpPublicPath, DEFAULT_CONFIG.derpPublicPath ?? ''),
  };
  createManager();

  return {
    hook: 'onInit',
    config: state.config,
  };
};

const onStart = async (): Promise<{ hook: string }> => {
  if (!state.manager) {
    createManager();
  }

  await state.manager!.start();
  const healthy = await state.manager!.healthCheck();
  state.started = healthy;
  emitHealth(healthy ? 'healthy' : 'unhealthy');

  return {
    hook: 'onStart',
  };
};

const onStop = async (): Promise<{ hook: string }> => {
  state.manager?.stop();
  state.started = false;
  emitHealth('degraded');
  return { hook: 'onStop' };
};

const onDestroy = async (): Promise<{ hook: string }> => {
  state.manager?.stop();
  state.started = false;
  return { hook: 'onDestroy' };
};

const invokeService = async (method: string, params: unknown): Promise<unknown> => {
  if (method === 'network-mode-status') {
    const running = state.started && (await state.manager?.healthCheck());
    return {
      plugin_id: state.pluginId,
      desired_mode: running ? 'M-NET' : 'DIRECT',
      mode: running ? 'M-NET' : 'DIRECT',
      healthy: Boolean(running),
    };
  }

  if (method === 'network-authkey') {
    if (!state.manager) {
      throw new Error('M-Net manager is not initialized');
    }

    const payload = isRecord(params) && isRecord(params.payload) ? params.payload : {};
    return state.manager.getClient().createAuthKey(payload);
  }

  if (method === 'network-derp-map') {
    if (!state.derpManager) {
      throw new Error('DERP manager is not initialized');
    }

    return state.derpManager.buildDerpMap();
  }

  throw new Error(`METHOD_NOT_FOUND:${method}`);
};

const handleInvoke = async (request: PluginInvokeRequest): Promise<PluginInvokeResponse> => {
  try {
    if (request.method === 'onInit') {
      return { success: true, data: await onInit(request.params) };
    }

    if (request.method === 'onStart') {
      return { success: true, data: await onStart() };
    }

    if (request.method === 'onStop') {
      return { success: true, data: await onStop() };
    }

    if (request.method === 'onDestroy') {
      return { success: true, data: await onDestroy() };
    }

    return {
      success: true,
      data: await invokeService(request.method, request.params),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const onMessage = (event: MessageEvent<unknown>): void => {
  const payload = event.data;
  if (!isPluginMessage(payload)) {
    return;
  }

  if (payload.type === PluginMessageType.INIT) {
    state.pluginId = payload.pluginId;
    return;
  }

  if (payload.type !== PluginMessageType.INVOKE || !isInvokeRequest(payload.payload)) {
    return;
  }

  void handleInvoke(payload.payload).then((result) => {
    globalThis.postMessage({
      id: payload.id,
      type: PluginMessageType.INVOKE_RESULT,
      pluginId: state.pluginId,
      timestamp: Date.now(),
      traceId: payload.traceId,
      payload: result,
    } satisfies PluginMessage);
  });
};

self.addEventListener('message', onMessage);
