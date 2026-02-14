type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type HeadscaleClientOptions = Readonly<{
  baseUrl: string;
  apiKey: string;
  fetcher?: Fetcher;
}>;

type HeadscaleVersionResponse = Readonly<{
  version?: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const isCompatibleVersion = (value: string): boolean => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  return /^v?0\.2[4-9]\./.test(normalized) || /^v?0\.[3-9]\d*\./.test(normalized);
};

export type HeadscaleClient = Readonly<{
  probeVersion: () => Promise<{ compatible: boolean; version: string | null }>;
  healthCheck: () => Promise<boolean>;
  createAuthKey: (payload: unknown) => Promise<unknown>;
  listMachines: () => Promise<unknown>;
  updateAcl: (payload: unknown) => Promise<unknown>;
}>;

export const createHeadscaleClient = (options: HeadscaleClientOptions): HeadscaleClient => {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Headscale request failed: ${path} -> ${response.status}`);
    }

    return readJson(response);
  };

  return Object.freeze({
    probeVersion: async () => {
      const payload = (await request('/api/v1/version')) as unknown;
      const versionPayload = isRecord(payload) ? (payload as HeadscaleVersionResponse) : {};
      const version = typeof versionPayload.version === 'string' ? versionPayload.version : null;

      return {
        compatible: version ? isCompatibleVersion(version) : false,
        version,
      };
    },
    healthCheck: async () => {
      try {
        await request('/health', {
          method: 'GET',
        });
        return true;
      } catch {
        return false;
      }
    },
    createAuthKey: async (payload: unknown) =>
      request('/api/v1/preauth-key', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    listMachines: async () => request('/api/v1/machine', { method: 'GET' }),
    updateAcl: async (payload: unknown) =>
      request('/api/v1/acl', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
  });
};
