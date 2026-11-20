# dsh-all-efforts

**为 DeepSeek Harness（DSH）中的 DeepSeek 模型补回 Medium 与 XHigh 两档推理强度**，让强度选择器与其他 DeepSeek 智能体一致：`关闭 · 低 · 中 · 高 · 极高 · 最高`，并且你选的那一档就是真正发给 DeepSeek 的档位。

[English](README.md) | [简体中文](README_CN.md)

---

## 问题

DSH 通过内置的 `dsh-llm-deepseek` 适配器连接 DeepSeek，该适配器把推理强度写死为四档：**Off**、**Low**、**High**、**Max**。而其他 DeepSeek 客户端和智能体通常提供更多档位（常见为 Low / Medium / High / XHigh / Max），切换到 DSH 后就无声地少了两个选项。

本插件把这两档补回来——它们是独立可选的真实档位，而不是 High 的快捷方式。其他一切保持原生：同一个 DeepSeek 卡片、同一份凭据、同一批模型、同一套会话。不需要再配置一个 provider，也不需要手动改任何文件。

## 你能得到什么

- 所有 DeepSeek 模型都有六档强度，出现在模型菜单以及读取模型声明档位的强度滑块里（包括常用的 `dsh-codex-effort-slider`）。
- `medium` 与 `xhigh` 会以 **`medium`、`xhigh`** 原样发往 DeepSeek：在 DSH 的序列化器通过校验之后，插件会在真正发出的请求体上把档位替换成你选的值。
- 覆盖配置里的每一条 DeepSeek 路由——官方 API Key、DeepSeek 账号以及自定义 `deepseek` 连接——因为插件挂在适配器实例上，而不是某一行 provider 上。
- `medium` 与 `xhigh` 像内置档位一样被保存和恢复：停在 Medium 的会话恢复后仍是 Medium。
- 零配置、不额外发起网络请求、不接触凭据、无遥测。一个无依赖的宿主插件。

## 安装

```sh
# web 应用配置（桌面端/网页端默认使用）
dsh plugin --profile web add github:KnPc1919/dsh-all-efforts

# 如果你使用 desktop 配置
dsh plugin --profile desktop add github:KnPc1919/dsh-all-efforts
```

安装后重启 DSH。打开 DeepSeek 模型的模型菜单，强度选择器会变成：

| | | | | | |
|---|---|---|---|---|---|
| 关闭 | 低 | 中 | 高 | 极高 | 最高 |

不启动应用也可以确认 bundle 层已生效：

```sh
dsh --profile web --dump-config | grep -A2 dsh-all-efforts
# == dsh-all-efforts
# - id: dsh-all-efforts
#   name: dsh-all-efforts
```

卸载：

```sh
dsh plugin --profile web remove dsh-all-efforts
```

卸载在下次重启 DSH 后生效。

## Medium 与 XHigh 如何抵达 DeepSeek

DSH 的 DeepSeek 序列化器会用自己的四个值校验请求强度，并把它写入请求体的 `output_config.effort`；适配器没有暴露传输层钩子。因此插件做三件事：

1. 先让原生序列化器收到一个合法占位档位（`high`，保持思考开启），使调用原样通过 DSH 的校验。
2. 在 `AsyncLocalStorage` 作用域中派发这次调用，作用域里记着你真正选择的档位。
3. 只包装一次 `globalThis.fetch`：作用域内发往 DeepSeek `…/messages` 的请求，其 JSON 请求体的 `output_config.effort` 会被改写成你的档位。

| 你的选择 | 发往 DeepSeek | 效果 |
|---|---|---|
| 关闭 | 关闭思考 | 不推理 |
| 低 | `low` | 低强度 |
| **中** | **`medium`** | 原样发送你选择的档位 |
| 高 | `high` | 高强度 |
| **极高** | **`xhigh`** | 原样发送你选择的档位 |
| 最高 | `max` | 最高强度 |

**兜底机制。** DeepSeek 公开文档只承诺传输层接受 `low`、`high`、`max`，并在自己的表里把 Medium/XHigh 描述为 High 的别名。如果某个端点拒绝了字面值（在任何输出开始前的 4xx 错误），插件会把这一次请求按官方映射（`medium → high`、`xhigh → high`）重试一次，输出一行警告，并让对话继续——绝不会比原生适配器更糟。映射只集中在 [`lib/efforts.js`](lib/efforts.js) 的 `WIRE_ALIASES` 一张表里。

## 实现方式

`cordis.patch.yml` 向配置插入一行宿主插件；插件等待 `llm` 服务就绪后：

1. 扫描已注册的 LLM 适配器，挑出类名为 `DeepSeekAdapter` 的实例。
2. 在该类上包装四个**公开**适配器方法：`resolveModel`、`listModels`、`prepareCall`、`stream`。
   - `resolveModel` / `listModels` 把声明的 `reasoning.efforts` 列表扩展出 Medium 与 XHigh——模型选择器和强度滑块读的就是它。
   - `prepareCall` / `stream` 负责派发：普通档位原样透传，Medium 与 XHigh 走上文所述的占位 + 作用域内请求体改写。
3. 监听 `llm/adapters-updated` 并重新扫描，后注册的适配器（其他配置、热重载、新增路由）同样生效。

插件不导入任何 DeepSeek 包，也不会在静态文件层面改动 `node_modules`。包装按类只安装一次、可重复执行，并且只作用于形态匹配的适配器。

**兼容性：** 关闭了思考模式的模型（只有 Off）保持不变。如果未来 DSH 版本重命名或移除上述适配器方法，插件只输出一行日志并保持原样，不会导致启动失败。

## 环境要求

- DSH `>= 0.2.0 < 0.3.0`（以 `engines.dsh` 声明；其他版本区间会被拒绝安装）。
- 配置里已经有一个可用的 DeepSeek 模型——插件只补档位，不提供凭据。

## 开发

```sh
npm test          # node:test 单元测试
```

| 路径 | 用途 |
|---|---|
| `index.js` | Cordis 插件：发现适配器并包装方法 |
| `lib/efforts.js` | 纯函数：档位列表、模型信息扩展、请求体改写 |
| `lib/wire.js` | 原样派发：档位作用域、fetch 请求体改写、一次性兜底 |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `locale/en.json`、`locale/zh.json` | DSH 中展示的插件标题与描述 |
| `test/efforts.test.js`、`test/wire.test.js` | 单元测试 |

## 许可证

[MIT](LICENSE)
