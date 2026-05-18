import readline from 'readline';
import type { ModelMessage } from 'ai';
import { agentLoop, resetStepCounter } from './agent/loop';
import {
	shouldCompress,
	compressHistory,
	buildCompressionHint,
} from './agent/context';

// ── CLI 多轮对话 ──────────────────────────────────────────────────────────────

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

readline.emitKeypressEvents(process.stdin, rl);
if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
}

rl.on('close', () => {
	isClosed = true;
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
	}
});

const PROMPT = '\n\x1b[34m> \x1b[0m';
const SLASH_COMMANDS = [
	{ name: '/help', description: '查看命令帮助' },
	{ name: '/reset', description: '清空当前会话历史，重新开始' },
	{ name: '/exit', description: '退出' },
];

// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
let history: ModelMessage[] = [];
// 运行时 hint 列表（如上下文压缩摘要，会注入系统提示词 Segment 3）
let runtimeHints: string[] = [];
let slashMenuLines = 0;
let isProcessing = false;
let isClosed = false;

class WorkingIndicator {
	private readonly startedAt = Date.now();
	private readonly frames = ['|', '/', '-', '\\'];
	private timer: Timer | undefined;
	private frameIndex = 0;

	start() {
		if (!process.stdout.isTTY || this.timer) return;
		this.render();
		this.timer = setInterval(() => this.render(), 120);
	}

	pause() {
		if (!process.stdout.isTTY) return;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.clearLine();
	}

	resume() {
		if (!process.stdout.isTTY || this.timer) return;
		this.render();
		this.timer = setInterval(() => this.render(), 120);
	}

	stop(): number {
		this.pause();
		return Date.now() - this.startedAt;
	}

	private render() {
		this.clearLine();
		const frame = this.frames[this.frameIndex % this.frames.length];
		this.frameIndex++;
		process.stdout.write(
			`\x1b[90m${frame} Working ${formatDuration(Date.now() - this.startedAt)}\x1b[0m`,
		);
	}

	private clearLine() {
		readline.clearLine(process.stdout, 0);
		readline.cursorTo(process.stdout, 0);
	}
}

process.stdin.on('keypress', (_char, key) => {
	if (key?.ctrl && key.name === 'c') {
		clearSlashMenu();
		console.log('再见！');
		rl.close();
		return;
	}

	if (isProcessing || isClosed) return;
	setTimeout(() => {
		if (!isProcessing && !isClosed) renderSlashMenu();
	}, 0);
});

rl.on('line', async (input) => {
	clearSlashMenu();
	const question = input.trim();

	// slash 命令
	if (question === '/exit' || question === '/quit') {
		console.log('再见！');
		rl.close();
		return;
	}

	if (question === '/reset') {
		history = [];
		runtimeHints = [];
		console.log('\x1b[90m[会话已重置]\x1b[0m');
		if (!isClosed) rl.prompt();
		return;
	}

	if (question === '/help') {
		printHelp();
		if (!isClosed) rl.prompt();
		return;
	}

	if (!question) {
		if (!isClosed) rl.prompt();
		return;
	}

	// ── 执行 Agent Loop ────────────────────────────────────────────────────────
	isProcessing = true;
	resetStepCounter();

	const working = new WorkingIndicator();
	working.start();

	try {
		const { text, responseMessages, usage, stepCount } = await agentLoop(
			question,
			history,
			runtimeHints,
			{
				beforeStepLog: () => working.pause(),
				afterStepLog: () => working.resume(),
			},
		);
		const elapsedMs = working.stop();

		// 将本轮消息（含所有中间工具调用步骤）追加到 history
		history.push({ role: 'user', content: question });
		history.push(...responseMessages);

		// 有工具调用（多步）时才打印分隔线，纯文本回答直接输出，避免重复
		if (stepCount > 1) {
			console.log(
				`\n\x1b[36m── 最终回答 ─────────────────────────────────────\x1b[0m`,
			);
		}
		console.log(text);
		console.log(`\n\x1b[90m─ Worked for ${formatDuration(elapsedMs)} ──\x1b[0m`);

		// ── 上下文压缩检查（本轮结束后，基于 API 返回的真实 token 用量）────────
		// promptTokens 是本轮实际发送的 token 数，比字符估算准确
		if (shouldCompress(usage.totalTokens!)) {
			console.log('\n\x1b[33m[上下文接近上限，正在压缩...]\x1b[0m');
			try {
				const summary = await compressHistory(history);
				const hint = buildCompressionHint(summary);
				history = [];
				runtimeHints = [hint];
				console.log('\x1b[90m[上下文已压缩，下次对话继续]\x1b[0m');
			} catch (e) {
				console.warn(`\x1b[33m[压缩失败: ${(e as Error).message}]\x1b[0m`);
			}
		}
	} catch (e) {
		working.stop();
		console.error(`\n\x1b[31m[错误] ${(e as Error).message}\x1b[0m`);
	} finally {
		isProcessing = false;
		if (!isClosed) rl.prompt();
	}
});

function renderSlashMenu() {
	if (!process.stdout.isTTY) return;

	const input = rl.line.trim();
	const matches =
		input.startsWith('/')
			? SLASH_COMMANDS.filter((command) => command.name.startsWith(input))
			: [];

	clearSlashMenu();
	if (matches.length === 0) {
		refreshInputLine();
		return;
	}

	process.stdout.write('\n');
	for (const command of matches) {
		process.stdout.write(
			`\x1b[90m${command.name} ${command.description}\x1b[0m\n`,
		);
	}
	slashMenuLines = matches.length + 1;
	refreshInputLine();
}

function clearSlashMenu() {
	if (!process.stdout.isTTY || slashMenuLines === 0) return;

	readline.moveCursor(process.stdout, 0, -slashMenuLines);
	for (let i = 0; i < slashMenuLines; i++) {
		readline.clearLine(process.stdout, 0);
		readline.moveCursor(process.stdout, 0, 1);
	}
	readline.moveCursor(process.stdout, 0, -slashMenuLines);
	slashMenuLines = 0;
}

function refreshInputLine() {
	(rl as unknown as { _refreshLine: () => void })._refreshLine();
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

function printHelp() {
	console.log(`
\x1b[1mmini-claude-code\x1b[0m — 教学用 Code Agent

\x1b[1m可用命令：\x1b[0m
${SLASH_COMMANDS.map((command) => `  ${command.name}   ${command.description}`).join('\n')}

\x1b[1m可用工具：\x1b[0m
  read_file   读取文件
  write_file  写入文件
  edit_file   局部编辑文件
  bash        执行 Shell 命令
  web_fetch   抓取网页内容
`);
}

// ── 启动 ──────────────────────────────────────────────────────────────────────

console.log(
	`\x1b[1mmini-claude-code\x1b[0m \x1b[90mv0.1.0 — 输入 /help 查看帮助\x1b[0m\n`,
);
rl.setPrompt(PROMPT);
rl.prompt();
