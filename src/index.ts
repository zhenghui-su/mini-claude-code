#!/usr/bin/env bun
import readline from 'readline';
import type { ModelMessage } from 'ai';
import { agentLoop, createExecutionPlan, resetStepCounter } from './agent/loop';
import {
	shouldCompress,
	compressHistory,
	buildCompressionHint,
} from './agent/context';
import {
	createSessionName,
	listSessions,
	saveSession,
	summarizeSession,
	type SavedSession,
} from './agent/session';
import { confirmQuestion } from './utils/confirm';
import packageJson from '../package.json';

// ── CLI 多轮对话 ──────────────────────────────────────────────────────────────

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
}

const PROMPT_TEXT = '\x1b[34m> \x1b[0m';
const PROMPT_COLUMNS = 2;
const SLASH_COMMANDS: SlashCommand[] = [
	{ name: '/help', description: '查看命令帮助' },
	{ name: '/plan', description: '本轮先制定计划再执行' },
	{ name: '/reset', description: '清空当前会话历史，重新开始' },
	{ name: '/sessions', description: '列出已保存会话' },
	{ name: '/exit', description: '退出' },
];

// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
let history: ModelMessage[] = [];
// 运行时 hint 列表（如上下文压缩摘要，会注入系统提示词 Segment 3）
let runtimeHints: string[] = [];
let currentSessionName = createSessionName();
let inputLine = '';
let renderedInputLines = 0;
let renderedResumeLines = 0;
let isResumeScreenActive = false;
let isInputActive = false;
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

process.stdin.on('keypress', (char, key) => {
	if (!isInputActive || isClosed) return;

	if (key?.ctrl && key.name === 'c') {
		closeCli();
		return;
	}

	if (key?.name === 'return') {
		void submitInput();
		return;
	}

	if (key?.name === 'backspace') {
		inputLine = inputLine.slice(0, -1);
		renderInput();
		return;
	}

	if (key?.ctrl && key.name === 'u') {
		inputLine = '';
		renderInput();
		return;
	}

	if (char && !key?.ctrl && !key?.meta) {
		inputLine += char;
		renderInput();
	}
});

async function handleLine(input: string) {
	const question = input.trim();

	// slash 命令
	if (question === '/exit' || question === '/quit') {
		closeCli();
		return;
	}

	if (question === '/reset') {
		history = [];
		runtimeHints = [];
		currentSessionName = createSessionName();
		await saveCurrentSession();
		console.log('\x1b[90m[会话已重置]\x1b[0m');
		startInput();
		return;
	}

	if (question === '/sessions') {
		const sessions = await listSessions();
		if (sessions.length === 0) {
			console.log('\x1b[90m[暂无已保存会话]\x1b[0m');
		} else {
			console.log('\n\x1b[1m已保存会话：\x1b[0m');
			for (const session of sessions) {
				const summary = summarizeSession(session);
				console.log(
					`  ${formatSessionTime(summary.updatedAt)}  ${summary.lastReplyPreview}`,
				);
			}
		}
		startInput();
		return;
	}

	if (question === '/help') {
		printHelp();
		startInput();
		return;
	}

	if (!question) {
		startInput();
		return;
	}

	const planQuestion = parsePlanInput(question);
	if (question === '/plan' || (question.startsWith('/plan ') && !planQuestion)) {
		startInput();
		return;
	}

	if (question.startsWith('/')) {
		if (question !== '/' && !planQuestion) {
			console.log(`\x1b[33m[未知命令] ${question}\x1b[0m`);
		}
		if (!planQuestion) {
			startInput();
			return;
		}
	}

	// ── 执行 Agent Loop ────────────────────────────────────────────────────────
	isProcessing = true;
	resetStepCounter();

	const working = new WorkingIndicator();
	working.start();

	try {
		const userQuestion = planQuestion ?? question;
		let executionQuestion = userQuestion;
		if (planQuestion) {
			const plan = await createExecutionPlan(userQuestion, history, runtimeHints);
			working.pause();
			console.log(
				`\n\x1b[36m── 执行计划 ─────────────────────────────────────\x1b[0m`,
			);
			console.log(plan);

			const approved = await confirmQuestion('\n按计划执行? (y/N) ');
			if (!approved) {
				console.log('\x1b[90m[已取消执行]\x1b[0m');
				return;
			}

			executionQuestion = [
				userQuestion,
				'',
				'用户已确认以下执行计划，请按计划继续：',
				plan,
			].join('\n');
			working.resume();
		}

		const { text, responseMessages, usage, stepCount } = await agentLoop(
			executionQuestion,
			history,
			runtimeHints,
			{
				beforeStepLog: () => working.pause(),
				afterStepLog: () => working.resume(),
			},
		);
		const elapsedMs = working.stop();

		// 将本轮消息（含所有中间工具调用步骤）追加到 history
		history.push({ role: 'user', content: userQuestion });
		history.push(...responseMessages);
		await saveCurrentSession();

		// 有工具调用（多步）时才打印分隔线，纯文本回答直接输出，避免重复
		if (stepCount > 1) {
			console.log(
				`\n\x1b[36m── 最终回答 ─────────────────────────────────────\x1b[0m`,
			);
		}
		console.log(text);
		console.log(
			`\n\x1b[90m─ Worked for ${formatDuration(elapsedMs)} ──\x1b[0m`,
		);

		// ── 上下文压缩检查（本轮结束后，基于 API 返回的真实 token 用量）────────
		// promptTokens 是本轮实际发送的 token 数，比字符估算准确
		if (shouldCompress(usage.totalTokens!)) {
			console.log('\n\x1b[33m[上下文接近上限，正在压缩...]\x1b[0m');
			try {
				const summary = await compressHistory(history);
				const hint = buildCompressionHint(summary);
				history = [];
				runtimeHints = [hint];
				await saveCurrentSession();
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
		startInput();
	}
}

function getSlashMatches(input: string): SlashCommand[] {
	const slashInput = input.trimStart();
	if (!slashInput.startsWith('/')) return [];
	if (slashInput.includes(' ')) return [];

	return SLASH_COMMANDS.filter((command) => command.name.startsWith(slashInput));
}

function parsePlanInput(input: string): string | undefined {
	if (!input.startsWith('/plan ')) return undefined;

	const content = input.slice('/plan'.length).trim();
	return content || undefined;
}

async function saveCurrentSession() {
	try {
		await saveSession(currentSessionName, { history, runtimeHints });
	} catch (e) {
		console.warn(`\x1b[33m[会话保存失败: ${(e as Error).message}]\x1b[0m`);
	}
}

async function chooseSession(): Promise<SavedSession | undefined> {
	const sessions = await listSessions();
	if (sessions.length === 0) {
		console.log('\x1b[90m[当前目录暂无历史会话]\x1b[0m');
		return undefined;
	}

	let selectedIndex = 0;

	return new Promise((resolve) => {
		const finish = (session: SavedSession | undefined) => {
			process.stdin.off('keypress', onKeypress);
			exitResumeScreen();
			resolve(session);
		};

		const onKeypress = (_char: string | undefined, key: readline.Key) => {
			if (key?.ctrl && key.name === 'c') {
				finish(undefined);
				return;
			}
			if (key?.name === 'escape' || key?.name === 'q') {
				finish(undefined);
				return;
			}
			if (key?.name === 'return') {
				finish(sessions[selectedIndex]);
				return;
			}
			if (key?.name === 'up') {
				selectedIndex = (selectedIndex - 1 + sessions.length) % sessions.length;
				renderResumeList(sessions, selectedIndex);
				return;
			}
			if (key?.name === 'down') {
				selectedIndex = (selectedIndex + 1) % sessions.length;
				renderResumeList(sessions, selectedIndex);
			}
		};

		process.stdin.on('keypress', onKeypress);
		enterResumeScreen();
		renderResumeList(sessions, selectedIndex);
	});
}

function renderResumeList(sessions: SavedSession[], selectedIndex: number) {
	const maxWidth = Math.max(40, (process.stdout.columns ?? 80) - 1);
	const lines = [
		`\x1b[1m${truncateByDisplayWidth('选择要恢复的会话', maxWidth)}\x1b[0m`,
		`\x1b[90m${truncateByDisplayWidth('↑/↓ 选择，Enter 恢复，q 取消', maxWidth)}\x1b[0m`,
		...sessions.map((session, index) => {
			const summary = summarizeSession(session);
			const marker = index === selectedIndex ? '›' : ' ';
			const prefix = `${marker} ${formatSessionTime(summary.updatedAt)}  `;
			const previewWidth = Math.max(8, maxWidth - displayWidth(prefix));
			const preview = truncateByDisplayWidth(
				summary.lastReplyPreview,
				Math.min(24, previewWidth),
			);
			const clipped = `${prefix}${preview}`;
			return index === selectedIndex ? `\x1b[7m${clipped}\x1b[0m` : clipped;
		}),
	];

	if (process.stdout.isTTY) {
		process.stdout.write('\x1b[H\x1b[2J');
	}
	process.stdout.write(lines.join('\n'));
	renderedResumeLines = lines.length;
}

function enterResumeScreen() {
	if (!process.stdout.isTTY || isResumeScreenActive) return;

	process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
	isResumeScreenActive = true;
}

function exitResumeScreen() {
	if (!process.stdout.isTTY || !isResumeScreenActive) return;

	process.stdout.write('\x1b[?25h\x1b[?1049l');
	isResumeScreenActive = false;
	renderedResumeLines = 0;
}

function printSessionTranscript(session: SavedSession) {
	const meaningful = session.history.filter(
		(message) => message.role === 'user' || message.role === 'assistant',
	);
	if (meaningful.length === 0) return;

	console.log('\x1b[1m已恢复历史记录：\x1b[0m');
	for (const message of meaningful) {
		const text = extractMessageText(message.content);
		if (!text) continue;

		const label = message.role === 'user' ? '你' : 'Agent';
		console.log(`\x1b[90m${label}:\x1b[0m ${truncateDisplay(text, 600)}`);
	}
	console.log('');
}

function extractMessageText(content: unknown): string {
	if (typeof content === 'string') return content.trim();
	if (Array.isArray(content)) {
		return content.map(extractMessageText).filter(Boolean).join(' ').trim();
	}
	if (!content || typeof content !== 'object') return '';

	const record = content as Record<string, unknown>;
	if (typeof record.text === 'string') return record.text.trim();
	if (typeof record.content === 'string') return record.content.trim();
	return '';
}

function truncateDisplay(text: string, maxChars: number): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	return compact.length > maxChars
		? `${compact.slice(0, maxChars - 1)}…`
		: compact;
}

function truncateByDisplayWidth(text: string, maxWidth: number): string {
	if (displayWidth(text) <= maxWidth) return text;

	const ellipsis = '…';
	const targetWidth = Math.max(1, maxWidth - displayWidth(ellipsis));
	let width = 0;
	let result = '';

	for (const char of text) {
		const charWidth = displayWidth(char);
		if (width + charWidth > targetWidth) break;
		result += char;
		width += charWidth;
	}

	return result + ellipsis;
}

function displayWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		width += isWideChar(char) ? 2 : 1;
	}
	return width;
}

function isWideChar(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (
		code >= 0x1100 &&
		(code <= 0x115f ||
			code === 0x2329 ||
			code === 0x232a ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe10 && code <= 0xfe19) ||
			(code >= 0xfe30 && code <= 0xfe6f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0xffe0 && code <= 0xffe6))
	);
}

function formatSessionTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;

	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startInput() {
	if (isClosed) return;
	isInputActive = true;
	inputLine = '';
	renderInput();
}

async function submitInput() {
	if (!isInputActive) return;

	const submitted = inputLine;
	if (!submitted.trim()) {
		inputLine = '';
		renderInput();
		return;
	}

	clearInputArea();
	process.stdout.write(`${PROMPT_TEXT}${submitted}\n`);
	inputLine = '';
	isInputActive = false;
	await handleLine(submitted);
}

function renderInput() {
	if (!process.stdout.isTTY) return;

	clearInputArea();
	const matches = getSlashMatches(inputLine);
	const lines = [
		`${PROMPT_TEXT}${formatInputLine(inputLine)}`,
		...matches.map(
			(command) =>
				`\x1b[90m${command.name.padEnd(16)} ${command.description}\x1b[0m`,
		),
	];

	process.stdout.write(lines.join('\n'));
	renderedInputLines = lines.length;

	if (matches.length > 0) {
		readline.moveCursor(process.stdout, 0, -matches.length);
	}
	readline.cursorTo(process.stdout, PROMPT_COLUMNS + inputLine.length);
}

function formatInputLine(value: string): string {
	if (value === '/plan') return '\x1b[7m/plan\x1b[0m';
	if (value.startsWith('/plan ')) {
		return `\x1b[7m/plan\x1b[0m${value.slice('/plan'.length)}`;
	}
	return value;
}

function clearInputArea() {
	if (!process.stdout.isTTY || renderedInputLines === 0) return;

	readline.cursorTo(process.stdout, 0);
	for (let i = 0; i < renderedInputLines; i++) {
		readline.clearLine(process.stdout, 0);
		if (i < renderedInputLines - 1) {
			readline.moveCursor(process.stdout, 0, 1);
		}
	}
	if (renderedInputLines > 1) {
		readline.moveCursor(process.stdout, 0, -(renderedInputLines - 1));
	}
	readline.cursorTo(process.stdout, 0);
	renderedInputLines = 0;
}

function closeCli() {
	if (isClosed) return;
	isClosed = true;
	clearInputArea();
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
	}
	console.log('再见！');
	process.exit(0);
}

interface SlashCommand {
	name: string;
	description: string;
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
  list_files  列出项目文件
  search      搜索项目内容
  read_file   读取文件
  write_file  写入文件
  edit_file   局部编辑文件
  bash        执行 Shell 命令
  web_fetch   抓取网页内容
`);
}

function printCliHelp() {
	console.log(`mini-claude-code ${packageJson.version}

Usage:
  minicc              启动新的本地 Code Agent 会话
  minicc resume       选择并恢复当前目录下的历史会话
  minicc --help       显示帮助
  minicc -h           显示帮助
  minicc -V           显示版本
  minicc --version    显示版本

In app:
  /help               查看交互命令
  /plan <任务>        本轮先制定计划再执行
  /sessions           列出当前目录历史会话
  /reset              清空当前会话并开启新会话
  /exit               退出
`);
}

function closeWithoutMessage() {
	isClosed = true;
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
	}
	process.exit(0);
}

// ── 启动 ──────────────────────────────────────────────────────────────────────

await bootstrap();

async function bootstrap() {
	const command = process.argv[2];
	if (command === '-V' || command === '--version') {
		console.log(packageJson.version);
		closeWithoutMessage();
		return;
	}
	if (command === '-h' || command === '--help') {
		printCliHelp();
		closeWithoutMessage();
		return;
	}

	console.log(
		`\x1b[1mmini-claude-code\x1b[0m \x1b[90mv${packageJson.version} — 输入 /help 查看帮助\x1b[0m`,
	);

	if (command === 'resume') {
		const session = await chooseSession();
		if (!session) {
			closeWithoutMessage();
			return;
		}

		currentSessionName = session.name;
		history = session.history;
		runtimeHints = session.runtimeHints;
		printSessionTranscript(session);
		startInput();
		return;
	} else if (command && command !== 'start') {
		console.log(`\x1b[33m[未知参数] ${command}\x1b[0m`);
		console.log('用法：minicc [resume|--help|-V]');
	}

	await saveCurrentSession();
	startInput();
}
