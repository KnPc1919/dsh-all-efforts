# dsh-all-efforts

**为 DeepSeek Harness（DSH）中的 DeepSeek 模型补回 Medium 与 XHigh 两档推理强度**，让强度选择器与其他 DeepSeek 智能体一致：`关闭 · 低 · 中 · 高 · 极高 · 最高`。

[English](README.md) | [简体中文](README_CN.md)

---

## 问题

DSH 通过内置的 `dsh-llm-deepseek` 适配器连接 DeepSeek，该适配器把推理强度写死为四档：**Off**、**Low**、**High**、**Max**。而其他 DeepSeek 客户端和智能体通常提供五档甚至更多（常见为 Low / Medium / High / XHigh / Max），切换到 DSH 后就无声地少了两个选项。

本插件把这两档补回来，其他一切保持原生：同一个 DeepSeek 卡片、同一份凭据、同一批模型、同一套会话。不需要再配置一个 provider，也不需要手动改任何文件。

## 你能得到什么

- 所有 DeepSeek 模型都有六档强度，出现在模型菜单以及读取模型声明档位的强度滑块里（包括常用的 `dsh-codex-effort-slider`）。
- 覆盖配置里的每一条 DeepSeek 路由——官方 API Key、DeepSeek 账号以及自定义 `deepseek` 连接——因为插件挂在适配器实例上，而不是某一行 provider 上。
- `medium` 与 `xhigh` 像内置档位一样被保存和恢复：停在 Medium 的会话恢复后仍是 Medium。
- 零配置、零网络请求、不接触凭据、无遥测。一个无依赖的宿主插件，约 200 行。

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

## 两档强度如何映射到 DeepSeek

DeepSeek 官方文档给出了一张别名表——你请求的强度，与模型实际使用的强度：

| 请求值 | 实际生效 |
|---|---|
| minimal | low |
| low | low |
| **medium** | **high** |
| high | high |
| **xhigh** | **high** |
| max | max |
| ultra | max |

Messages API 在传输层只接受 `low`、`high`、`max`，因此 **Medium 与 XHigh 是 High 的界面别名**——这正是 DeepSeek 的定义，也是其他智能体展示的内容。插件保留这两档的可见性与可选性，并在请求离开 DSH 之前、于适配器边界完成转换：

| 你的选择 | 发往 DeepSeek | 效果 |
|---|---|---|
| 关闭 | 关闭思考 | 不推理 |
| 低 | `low` | 低强度 |
| 中 | `high` | 高强度 |
| 高 | `high` | 高强度 |
| 极高 | `high` | 高强度 |
| 最高 | `max` | 最高强度 |

如果 DeepSeek 以后为这两档提供独立取值，映射只集中在 [`lib/efforts.js`](lib/efforts.js) 的一张表（`WIRE_ALIASES`）里，改动它即可，无需触碰插件其他部分。

## 实现方式

`cordis.patch.yml` 向配置插入一行宿主插件；插件等待 `llm` 服务就绪后：

1. 扫描已注册的 LLM 适配器，挑出类名为 `DeepSeekAdapter` 的实例。
2. 在该类上包装四个**公开**适配器方法：`resolveModel`、`listModels`、`prepareCall`、`stream`。
   - `resolveModel` / `listModels` 把声明的 `reasoning.efforts` 列表扩展出 Medium 与 XHigh——模型选择器和强度滑块读的就是它。
   - `prepareCall` / `stream` 在构造请求之前把这两个别名改写为实际强度，因此 DSH 自身的校验、会话记录与重试逻辑看到的始终是合法档位。
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
| `lib/efforts.js` | 纯函数：档位列表、模型信息扩展、传输值转换 |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `locale/en.json`、`locale/zh.json` | DSH 中展示的插件标题与描述 |
| `test/efforts.test.js` | 单元测试 |

## 许可证

[MIT](LICENSE)
