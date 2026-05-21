# mini-claude-code

mini-claude-code 是一个教学用本地 Code Agent。它运行在终端里，通过 LLM + tools 完成项目理解、文件读写、Shell 执行和网页抓取。

## Quick Start

```sh
bun install
bun src/index.ts
```

需要在 `.env` 中配置：

```sh
DEEPSEEK_API_KEY=...
DEEPSEEK_API_BASE_URL=https://api.deepseek.com
```

## Project Structure

```sh
src/
├── cli/
│   ├── app.ts               # CLI 应用状态、命令分发和多轮输入
│   ├── constants.ts         # 提示符与 slash 命令定义
│   ├── format.ts            # 终端展示、时间和宽字符格式化
│   ├── help.ts              # 帮助与版本说明
│   ├── resume.ts            # 历史会话选择/恢复界面
│   ├── slash.ts             # slash 命令匹配与解析
│   └── working-indicator.ts # 执行中动画
├── agent/
│   ├── loop.ts       # Agent 循环：模型调用、工具回填、步骤输出
│   ├── context.ts    # 分层上下文状态、压缩与记忆派生
│   ├── session.ts    # 会话保存/恢复与旧格式迁移
│   ├── prompt.ts     # 系统提示词组装
│   └── provider.ts   # 模型提供商配置
├── tools/
│   ├── index.ts      # 工具注册
│   ├── result.ts     # 统一工具返回结构
│   ├── list-files.ts
│   ├── search.ts
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── edit-file.ts
│   ├── bash.ts
│   └── web-fetch.ts
├── utils/
│   ├── safety.ts     # 路径安全、命令风险、工具权限分类
│   ├── confirm.ts    # 用户确认
│   └── truncate.ts   # 工具输出截断
└── index.ts          # CLI 入口
tests/
├── agent/            # 会话、上下文等 agent 层测试
├── tools/            # 工具行为测试
└── utils/            # 安全、截断等工具函数测试
```

## Agent Flow

```txt
用户输入
  ↓
CLI 处理 slash command / 普通任务
  ↓
assembleSystemPrompt() 拼接系统提示词和运行时状态
  ↓
generateText() 调用模型
  ↓
模型选择 tool call
  ↓
tool 执行并返回 { ok, message, data }
  ↓
AI SDK 将工具结果回填到 history
  ↓
模型继续推理，直到输出最终回答
```

CLI 会在每轮输入前显示 HUD，展示当前模型、最近 prompt token 占用、摘要状态和压缩次数。

当上下文接近上限时，`context.ts` 会自动把历史压缩为结构化摘要；你也可以用 `/compact` 主动触发压缩。压缩后的摘要会写入 typed context state，并在后续轮次按“运行时状态 / 用户约束 / 工作记忆 / 会话摘要”的顺序注入系统提示词。

## Commands

输入 `/` 会在当前输入行下方显示命令菜单；继续输入字母会按前缀过滤，例如 `/p` 只显示 `/plan`。菜单只做提示，不会自动补全，命令仍由用户手动输入完整。

- `/help`：查看帮助。
- `/plan <任务>`：只对本轮开启计划模式，先生成执行计划，用户确认后才继续执行。输入框里 `/plan` 会高亮；不加 `/plan` 就是普通模式。
- `/context`：查看当前上下文状态、token 用量、压缩次数和摘要情况。
- `/compact`：立即压缩当前上下文，把历史折叠成结构化摘要。
- `/sessions`：列出已保存会话。
- `/reset`：清空当前会话历史。
- `/exit`：退出。

## Sessions

会话会自动保存到当前目录的 `.mini-claude/sessions/`，不需要手动输入保存命令。每次启动都会创建或更新当前会话；每轮对话完成后也会自动保存。新的会话文件会同时持久化：

- `history`：原始消息历史
- `context`：模型 ID、context limit、最近 token 用量、压缩摘要、working memory、user constraints

旧版只包含 `runtimeHints` 的会话文件会在加载时自动迁移到新的 `context` 结构。

恢复历史会话：

```sh
minicc resume
```

`resume` 会显示当前目录下的历史会话列表，每一项包含最后更新时间和最近一次 Agent 回复的摘要。使用 `↑/↓` 选择，`Enter` 恢复，`q` 取消。恢复后会先打印之前的对话记录，然后继续对话。

## Global Install

本地开发时可以链接成全局命令：

```sh
bun run build
npm link
minicc
minicc resume
```

如果不想使用 `npm link`，也可以在项目根目录直接安装当前包：

```sh
bun run build
npm i -g .
```

也可以额外打包成当前平台的独立可执行文件：

```sh
bun run build:binary
./dist/minicc
./dist/minicc resume
```

## Tools

所有工具统一返回：

```ts
interface ToolResult<T = unknown> {
	ok: boolean;
	message: string;
	data?: T;
}
```

当前工具按权限分为四类：

- `read`：`list_files`、`search`、`read_file`
- `write`：`write_file`、`edit_file`
- `execute`：`bash`
- `network`：`web_fetch`

`bash` 会对高风险命令做拦截或确认；文件工具只能访问当前工作目录内的路径；超长工具输出会被截断并附带结构化提示。

## Add a Tool

1. 在 `src/tools/` 新建实现文件，返回 `ToolResult`。
2. 在 `src/tools/index.ts` 中用 `tool({ description, inputSchema, execute })` 注册。
3. 在 `src/utils/safety.ts` 的 `TOOL_PERMISSIONS` 中标注权限。
4. 在 `src/SYSTEM_PROMPT.md` 中补充工具使用建议。
5. 为工具新增 `bun test` 单元测试。

## Testing

```sh
bun run tsc --noEmit
bun test
```
