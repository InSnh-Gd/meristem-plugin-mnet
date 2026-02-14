import { createHeadscaleClient, type HeadscaleClient } from './headscale-client';

export type HeadscaleProcess = Readonly<{
  pid: number;
  kill: (signal?: string) => void;
  onExit: (handler: (code: number | null) => void) => void;
}>;

type ProcessFactory = (input: {
  binary: string;
  args: string[];
  env: Record<string, string | undefined>;
}) => HeadscaleProcess;

export type HeadscaleManagerOptions = Readonly<{
  binaryPath: string;
  configPath: string;
  apiUrl: string;
  apiKey: string;
  maxRestarts?: number;
  processFactory?: ProcessFactory;
  client?: HeadscaleClient;
}>;

export type HeadscaleStatus = Readonly<{
  running: boolean;
  restartCount: number;
  compatible: boolean;
  version: string | null;
}>;

const defaultProcessFactory: ProcessFactory = ({ binary, args, env }) => {
  const subprocess = Bun.spawn([binary, ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    pid: subprocess.pid,
    kill: (signal?: string) => {
      subprocess.kill((signal ?? 'SIGTERM') as NodeJS.Signals);
    },
    onExit: (handler) => {
      void subprocess.exited.then((code) => {
        handler(code);
      });
    },
  };
};

/**
 * 逻辑块：Headscale 进程管理器封装 Sidecar 生命周期。
 * - 目的：统一处理启动、版本探测、健康检测、异常重启与有界熔断。
 * - 原因：M-Net 插件需要对 Headscale 进程提供可预测的运行语义，避免 Core 侧散落控制逻辑。
 * - 失败路径：版本不兼容或重启超限时直接 fail-fast，维持插件错误态并阻断继续切换到 M-Net。
 */
export const createHeadscaleManager = (options: HeadscaleManagerOptions) => {
  const maxRestarts = options.maxRestarts ?? 3;
  const processFactory = options.processFactory ?? defaultProcessFactory;
  const client =
    options.client ??
    createHeadscaleClient({
      baseUrl: options.apiUrl,
      apiKey: options.apiKey,
    });

  let processRef: HeadscaleProcess | null = null;
  let restartCount = 0;
  let status: HeadscaleStatus = Object.freeze({
    running: false,
    restartCount: 0,
    compatible: false,
    version: null,
  });

  const updateStatus = (next: Partial<HeadscaleStatus>): void => {
    status = Object.freeze({
      ...status,
      ...next,
    });
  };

  const spawn = (): void => {
    processRef = processFactory({
      binary: options.binaryPath,
      args: ['serve', '--config', options.configPath],
      env: {},
    });

    processRef.onExit(() => {
      updateStatus({ running: false });

      if (restartCount >= maxRestarts) {
        return;
      }

      restartCount += 1;
      updateStatus({ restartCount });
      spawn();
      updateStatus({ running: true });
    });
  };

  const start = async (): Promise<HeadscaleStatus> => {
    if (processRef) {
      return status;
    }

    const version = await client.probeVersion();
    if (!version.compatible) {
      updateStatus({
        compatible: false,
        version: version.version,
      });
      throw new Error(`Incompatible Headscale version: ${version.version ?? 'unknown'}`);
    }

    spawn();
    updateStatus({
      running: true,
      compatible: true,
      version: version.version,
    });
    return status;
  };

  const stop = (): void => {
    if (!processRef) {
      return;
    }

    const current = processRef;
    processRef = null;
    current.kill('SIGTERM');
    updateStatus({
      running: false,
    });
  };

  const reloadConfig = (): void => {
    if (!processRef) {
      return;
    }

    processRef.kill('SIGHUP');
  };

  const healthCheck = async (): Promise<boolean> => {
    if (!processRef) {
      updateStatus({ running: false });
      return false;
    }

    const healthy = await client.healthCheck();
    if (!healthy) {
      updateStatus({ running: false });
    }
    return healthy;
  };

  return Object.freeze({
    start,
    stop,
    reloadConfig,
    healthCheck,
    getStatus: (): HeadscaleStatus => status,
    getClient: (): HeadscaleClient => client,
  });
};
