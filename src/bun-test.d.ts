declare module 'bun:test' {
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toHaveLength: (expected: number) => void;
    toThrow: (expected?: string | RegExp) => Promise<void> | void;
    rejects: {
      toThrow: (expected?: string | RegExp) => Promise<void>;
    };
  };
}
