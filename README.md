# mini-claude-code

mini-claude-code，一个运行在用户本地终端的 Code Agent
可以读写文件、执行 Shell 命令、访问网络，帮助用户完成编程和开发任务。

项目结构

```sh
mini-claude-code/
├── src/
│   ├── agent/
│   │   ├── loop.ts      # Agent 循环核心
│   │   ├── context.ts   # 上下文管理
│   │   ├── prompt.ts    # 提示词组装
│   │   └── provider.ts  # 模型提供商配置
│   ├── tools/
│   │   ├── index.ts     # 工具注册
│   │   ├── read-file.ts
│   │   ├── write-file.ts
│   │   ├── edit-file.ts
│   │   ├── bash.ts
│   │   └── web-fetch.ts
│   ├── index.ts         # 入口
│   └── SYSTEM_PROMPT.md # 系统提示词
├── package.json
└── .env.example

```
