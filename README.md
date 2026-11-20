# dsh-all-efforts

**Add the Medium and XHigh reasoning-effort levels to DeepSeek models in DeepSeek Harness (DSH)** — so the effort control offers the same six levels as other DeepSeek agents: `Off · Low · Medium · High · XHigh · Max`, and the level you pick is the level sent to DeepSeek.

[English](README.md) | [简体中文](README_CN.md)

---

## The problem

DSH talks to DeepSeek through its built-in `dsh-llm-deepseek` adapter, which hard-codes four reasoning efforts: **Off**, **Low**, **High**, **Max**. Other DeepSeek clients and agent tools expose more (usually Low / Medium / High / XHigh / Max), so switching to DSH silently removes two choices.

This plugin adds those two choices back — as real, independently selectable levels, not as shortcuts for High. Everything else stays stock: the same DeepSeek card, the same credentials, the same models, the same sessions. There is no second provider to configure and nothing to edit by hand.

## What you get

- Six effort levels on every DeepSeek model, in the model menu and in effort sliders that read the model's declared levels (including the popular `dsh-codex-effort-slider`).
- `medium` and `xhigh` travel to DeepSeek as **`medium` and `xhigh`** — the plugin replaces the value on the outgoing request body after DSH's serializer has accepted the call.
- Works for every DeepSeek route in the profile — official API key, DeepSeek account, and any custom `deepseek` connection — because the plugin attaches to the adapter instances, not to one provider row.
- `medium` and `xhigh` are stored and resumed like built-in levels: a session that stops on Medium continues on Medium.
- No configuration, no extra network calls, no credentials touched, no telemetry. One dependency-free host plugin.

## Install

```sh
# web app profile (the default desktop/web surface)
dsh plugin --profile web add github:KnPc1919/dsh-all-efforts

# desktop profile, if you use it
dsh plugin --profile desktop add github:KnPc1919/dsh-all-efforts
```

Restart DSH after installing. Open the model menu for a DeepSeek model and the effort control now lists:

| | | | | | |
|---|---|---|---|---|---|
| Off | Low | Medium | High | XHigh | Max |

Verify that the bundle layer was applied without booting:

```sh
dsh --profile web --dump-config | grep -A2 dsh-all-efforts
# == dsh-all-efforts
# - id: dsh-all-efforts
#   name: dsh-all-efforts
```

To uninstall:

```sh
dsh plugin --profile web remove dsh-all-efforts
```

Removal takes effect after the next DSH restart.

## How Medium and XHigh reach DeepSeek

DSH's DeepSeek serializer validates the requested level against its own four values and writes it into the request body as `output_config.effort`. It exposes no transport hook, so the plugin does three things:

1. It hands the stock serializer a legal placeholder level (`high`, which keeps thinking enabled) so the call passes DSH's validation unchanged.
2. It dispatches the call inside an `AsyncLocalStorage` scope that remembers the level you picked.
3. It wraps `globalThis.fetch` once; for DeepSeek `…/messages` requests inside that scope, the outgoing JSON body gets `output_config.effort` set to your level.

| Your choice | Sent to DeepSeek | Effect |
|---|---|---|
| Off | thinking disabled | no reasoning |
| Low | `low` | low effort |
| **Medium** | **`medium`** | your chosen level, verbatim |
| High | `high` | high effort |
| **XHigh** | **`xhigh`** | your chosen level, verbatim |
| Max | `max` | max effort |

**Safety net.** DeepSeek's public documentation only promises `low`, `high`, and `max` on the wire and describes Medium/XHigh as aliases of High in its own table. If an endpoint rejects the literal value (a 4xx error before any output has streamed), the plugin retries that one request with the documented mapping (`medium → high`, `xhigh → high`), logs a single warning, and keeps the conversation alive — it never leaves you worse off than the stock adapter. The mapping lives in one table (`WIRE_ALIASES` in [`lib/efforts.js`](lib/efforts.js)).

## How it works

`cordis.patch.yml` inserts one host-only row into the profile, and the plugin waits for the `llm` service:

1. It scans the registered LLM adapters and picks the instances whose class is `DeepSeekAdapter`.
2. It wraps four **public** adapter methods on that class: `resolveModel`, `listModels`, `prepareCall`, and `stream`.
   - `resolveModel` / `listModels` widen the declared `reasoning.efforts` list with Medium and XHigh, which is what the model picker and the effort sliders read.
   - `prepareCall` / `stream` dispatch the call: ordinary levels pass through byte-for-byte, while Medium and XHigh use the placeholder + scoped body rewrite described above.
3. It re-scans whenever `llm/adapters-updated` fires, so adapters registered later (other profiles, hot reloads, extra routes) are covered too.

No DeepSeek package is imported and nothing in `node_modules` is modified at rest. The wrappers are installed once per class, are idempotent, and are only applied to adapters whose shape matches what is described above.

**Compatibility:** a model whose thinking mode is disabled (Off only) is left untouched. If a future DSH release renames or removes those adapter methods, the plugin logs one line and changes nothing instead of failing startup.

## Requirements

- DSH `>= 0.2.0 < 0.3.0` (declared as `engines.dsh`; installation refuses other ranges).
- A DeepSeek model already configured in your profile — the plugin adds levels, it does not add credentials.

## Development

```sh
npm test          # node:test unit tests
```

| Path | Purpose |
|---|---|
| `index.js` | Cordis plugin: adapter discovery and method wrappers |
| `lib/efforts.js` | Pure helpers: level list, model-info widening, request-body rewrite |
| `lib/wire.js` | Verbatim dispatch: effort scope, fetch body rewrite, one-shot fallback |
| `cordis.patch.yml` | Bundle layer that inserts the plugin row |
| `locale/en.json`, `locale/zh.json` | Plugin title and description shown in DSH |
| `test/efforts.test.js`, `test/wire.test.js` | Unit tests |

## License

[MIT](LICENSE)
