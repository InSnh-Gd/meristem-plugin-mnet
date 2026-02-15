# meristem-plugin-mnet

M-Net plugin for Meristem core.

## Scope

- Exports network mode status (`DIRECT` or `M-NET`).
- Issues network auth keys through Headscale API.
- Builds DERP map for self-hosted/public/hybrid modes.

## Runtime

- Runtime: Bun
- Language: TypeScript (ESM)

## External Dependencies

`com.meristem.mnet` is not self-contained. It requires external network components:

- `headscale` executable (or a compatible wrapper script) available via:
  - `MERISTEM_MNET_HEADSCALE_BIN=/abs/path/to/headscale`, or
  - default command name `headscale` available in `$PATH`
- Reachable Headscale API endpoint (from Core process):
  - `MERISTEM_MNET_HEADSCALE_API_URL`
  - `MERISTEM_MNET_HEADSCALE_API_KEY`
  - minimum endpoints used by plugin runtime:
    - `GET /api/v1/version`
    - `GET /health`
    - `POST /api/v1/preauth-key`
- Public DERP source for `hybrid` / `public-only` mode:
  - `MERISTEM_MNET_DERP_PUBLIC_PATH=/abs/path/public-derp.json`
  - JSON format: array of DERP nodes or `{ "nodes": [...] }`

If these dependencies are missing, plugin `start` will fail and state becomes `START_ERROR`.

## Required Environment Examples

```bash
MERISTEM_MNET_HEADSCALE_BIN=/opt/meristem/headscale
MERISTEM_MNET_HEADSCALE_CONFIG=/opt/meristem/headscale.yaml
MERISTEM_MNET_HEADSCALE_API_URL=http://127.0.0.1:8079
MERISTEM_MNET_HEADSCALE_API_KEY=replace-me
MERISTEM_MNET_DERP_PUBLIC_PATH=/opt/meristem/derp/public-derp.json
```

## Runtime Verification

```bash
# After core is running and plugin is loaded/init/start invoked:
curl -s http://127.0.0.1:3000/api/v1/plugins/com.meristem.mnet/state
```

Expected result for healthy runtime:

- `"state": "RUNNING"`

Common dependency failure:

- `"state": "START_ERROR"`
- `"error": "Executable not found in $PATH: \"headscale\""`

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
