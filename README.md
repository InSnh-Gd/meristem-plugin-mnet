# meristem-plugin-mnet

M-Net plugin for Meristem core.

## Scope

- Exports network mode status (`DIRECT` or `M-NET`).
- Issues network auth keys through Headscale API.
- Builds DERP map for self-hosted/public/hybrid modes.

## Runtime

- Runtime: Bun
- Language: TypeScript (ESM)

## Commands

```bash
bun run test
bun run build
```

## Layout

- `src/`: plugin runtime and managers
- `__tests__/`: unit tests
- `plugin.json`: plugin manifest
- `dist/`: build output (generated)

