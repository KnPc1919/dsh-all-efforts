# dsh-all-efforts

**Restore the Medium and XHigh reasoning-effort levels for DeepSeek models in DeepSeek Harness (DSH)** — so the effort control offers the same six levels as other DeepSeek agents: `Off · Low · Medium · High · XHigh · Max`.

[English](README.md) | [简体中文](README_CN.md)

---

## The problem

DSH talks to DeepSeek through its built-in `dsh-llm-deepseek` adapter, which hard-codes four reasoning efforts: **Off**, **Low**, **High**, **Max**. Other DeepSeek clients and agent tools expose five or more (usually Low / Medium / High / XHigh / Max), so switching to DSH silently removes two choices.

This plugin adds those two choices back. Everything else stays stock: the same DeepSeek card, the same credentials, the same models, the same sessions. There is no second provider to configure and nothing to edit by hand.

## What you get

- Six effort levels on every DeepSeek model, in the model menu and in effort sliders that read the model's declared levels (including the popular `dsh-codex-effort-slider`).
- Works for every DeepSeek route in the profile — official API key, DeepSeek account, and any custom `deepseek` connection — because the plugin attaches to the adapter instances, not to one provider row.
- `medium` and `xhigh` are stored and resumed like built-in levels: a session that stops on Medium continues on Medium.
- No configuration, no network calls, no credentials touched, no telemetry. One dependency-free host plugin, about 200 lines.

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

## How the two levels map to DeepSeek

DeepSeek documents its effort control with an alias table — the effort you ask for versus the effort the model actually runs with:

| Requested | Effective |
|---|---|
| minimal | low |
| low | low |
| **medium** | **high** |
| high | high |
| **xhigh** | **high** |
| max | max |
| ultra | max |

The Messages API only accepts `low`, `high`, and `max` on the wire, so **Medium and XHigh are UI aliases of High** — exactly as DeepSeek defines them, and exactly what other agents show. The plugin keeps the levels visible and selectable, then translates the request at the adapter boundary before it leaves DSH:

| Your choice | Sent to DeepSeek | Effect |
|---|---|---|
| Off | thinking disabled | no reasoning |
| Low | `low` | low effort |
| Medium | `high` | high effort |
| High | `high` | high effort |
| XHigh | `high` | high effort |
| Max | `max` | max effort |

If DeepSeek later accepts distinct values for these levels, the mapping lives in one table (`WIRE_ALIASES` in [`lib/efforts.js`](lib/efforts.js)) and can be updated without touching the rest of the plugin.

## How it works

`cordis.patch.yml` inserts one host-only row into the profile, and the plugin waits for the `llm` service:

1. It scans the registered LLM adapters and picks the instances whose class is `DeepSeekAdapter`.
2. It wraps four **public** adapter methods on that class: `resolveModel`, `listModels`, `prepareCall`, and `stream`.
   - `resolveModel` / `listModels` widen the declared `reasoning.efforts` list with Medium and XHigh, which is what the model picker and the effort sliders read.
   - `prepareCall` / `stream` rewrite `reasoningEffort` for the two aliases before the request is built, so DSH's own validation, session records, and retry logic keep seeing a normal level.
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
| `lib/efforts.js` | Pure helpers: level list, model-info widening, wire translation |
| `cordis.patch.yml` | Bundle layer that inserts the plugin row |
| `locale/en.json`, `locale/zh.json` | Plugin title and description shown in DSH |
| `test/efforts.test.js` | Unit tests |

## License

[MIT](LICENSE)
