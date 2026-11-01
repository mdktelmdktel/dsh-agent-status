# dsh-agent-status

给 [DeepSeek Harness](https://github.com/deepseek-ai)（`dsh`）用的一个小插件：**在会话标题栏实时显示 agent 现在做到哪一步**。

不用点开、不用翻记录，一眼就能看到它当前在干什么、做到第几步、这一轮跑了多久、待办推到第几项。

```
● 执行命令：pnpm test · 第 12 步 · 1:38 · 待办 3/7
● 修改文件：client.js · 第 8 步 · 0:42
✓ 上一轮完成 · 6 步 · 1:12          ← 空闲 9 秒后自动消失
```

- **●** 蓝点脉冲 = 正在干活
- **✓** 绿点 = 刚结束的一轮
- **✗** 红点 = 最近一次工具调用失败
- 鼠标悬停 → 当前待办原文 + 最近 4 个动作（工具 / 目标 / 耗时 / 成败）

## 显示什么

| 字段 | 含义 |
| --- | --- |
| 当前动作 | 工具名翻译成人话：`ops_bash` → 执行命令，`edit` → 修改文件，`ops_grep` → 搜索代码，`todo_write` → 更新任务清单……并在后面附上参数摘要（命令描述、文件路径、搜索词、队友名） |
| 第 N 步 | 这一轮里第几次模型请求（每批工具调用算一步） |
| 本轮耗时 | 从 `turn/start` 到现在的实际时间 |
| 待办 x/y | agent 调过 `todo_write` 时，取它自己的任务清单进度与当前项 |

前两个是"现在"，后两个是"做到哪里"——这就是它要回答的问题。

## 安装

```
github:mdktelmdktel/dsh-agent-status
```

在 Plugin Manager 里装这个 bundle，或手工等价操作（profile 目录 `~/.dsh/profiles/<name>`）：

1. `package.json` 的 `dependencies` 加 `"dsh-agent-status": "github:mdktelmdktel/dsh-agent-status"`
2. `package.json` 的 `dsh.profile.bundles` 加 `"dsh-agent-status"`
3. `pnpm install`，HMR 会当场激活新 bundle

装完**刷新一次页面**（`Ctrl+R`）就能看到胶囊。想关掉：插件行上 `disabled: true`。

> npm 上有个同名包（`dsh-agent-status`，作者 `r2s`，2026-10-20 发布，做的是类似的事），**不是**这个插件。请认准 `mdktelmdktel/dsh-agent-status`。

## 原理

两个部分，一个数据源：

```
Host                                   Client
session/event ──折叠──> per-session state      1.2s 轮询
   turn/start          { phase, tool, detail,       │
   tool/call            step, turnMs, todo,        ▼
   tool/result          recent }            conversation.session.header.utilities
   assistant/message         │                 → 胶囊组件
   turn/end                  ▼
                    GET /agent-status/api/state
```

- **只吃持久事件**：`turn/start` / `tool/call` / `tool/result` / `assistant/message` / `turn/end`，所以状态可重建，也不依赖任何 per-agent 订阅。
- **子 agent 自动覆盖**：subagent 也是 session，同一个折叠器直接为其记账。
- **内存态、无落盘**：会话 15 分钟无事件即回收，最多保留 48 个会话。
- **零配置**。要改轮询间隔就改 `client.js` 里的 `POLL_MS`。

## 已知限制

- 胶囊显示的是**宿主内存里的当前状态**：页面在某一轮中途打开时，`第 N 步` 从插件观察到的位置开始计，不会回溯这一轮此前的事件。
- 宿主侧 `index.js` 改动**不会热更**（只有"新装 bundle"能被 HMR 激活），改宿主代码要重启应用；客户端 `client.js` 改动会经 client-hmr 自动下发。
- `/agent-status/api/state` 只监听回环地址、不做鉴权，内容仅为工具名与参数摘要。

## 文件

```
index.js           宿主半：事件折叠 + JSON API
client.js          浏览器半：window.__ModuleLoader__ 手写模块 + 胶囊组件
cordis.patch.yml   bundle patch（插入一行 agent-status）
locale/{zh,en}.json  插件管理页的标题与描述
icon.svg           插件图标
```

## License

MIT
