import readline from 'readline';
import type { ModelMessage } from 'ai';
import { agentLoop, createExecutionPlan, resetStepCounter } from '../agent/loop';
import {
	shouldCompress,
	compressHistory,
	buildCompressionHint,
} from '../agent/context';
import {
	createSessionName,
	listSessions,
	saveSession,
	summarizeSession,
} from '../agent/session';
import { confirmQuestion } from '../utils/confirm';
import packageJson from '../../package.json';
import { PROMPT_COLUMNS, PROMPT_TEXT, SLASH_COMMANDS } from './constants';
import { formatDuration, formatSessionTime, displayWidth } from './format';
import { printCliHelp, printHelp } from './help';
import { chooseSession, printSessionTranscript } from './resume';
import { getSlashMatches, parsePlanInput } from './slash';
import { WorkingIndicator } from './working-indicator';

export async function runCli() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	const app = new CliApp();
	process.stdin.on('keypress', app.handleKeypress);
	await app.bootstrap();
}

class CliApp {
	// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
	private history: ModelMessage[] = [];
	// 运行时 hint 列表（如上下文压缩摘要，会注入系统提示词 Segment 3）
	private runtimeHints: string[] = [];
	private currentSessionName = createSessionName();
	private inputLine = '';
	private renderedInputLines = 0;
	private isInputActive = false;
	private isClosed = false;

	handleKeypress = (char: string | undefined, key: readline.Key) => {
		if (!this.isInputActive || this.isClosed) return;

		if (key?.ctrl && key.name === 'c') {
			this.closeCli();
			return;
		}

		if (key?.name === 'return') {
			void this.submitInput();
			return;
		}

		if (key?.name === 'backspace') {
			this.inputLine = this.inputLine.slice(0, -1);
			this.renderInput();
			return;
		}

		if (key?.ctrl && key.name === 'u') {
			this.inputLine = '';
			this.renderInput();
			return;
		}

		if (char && !key?.ctrl && !key?.meta) {
			this.inputLine += char;
			this.renderInput();
		}
	};

	async bootstrap() {
		const command = process.argv[2];
		if (command === '-V' || command === '--version') {
			console.log(packageJson.version);
			this.closeWithoutMessage();
			return;
		}
		if (command === '-h' || command === '--help') {
			printCliHelp();
			this.closeWithoutMessage();
			return;
		}

		console.log(
			`\x1b[1mmini-claude-code\x1b[0m \x1b[90mv${packageJson.version} — 输入 /help 查看帮助\x1b[0m`,
		);

		if (command === 'resume') {
			const session = await chooseSession();
			if (!session) {
				this.closeWithoutMessage();
				return;
			}

			this.currentSessionName = session.name;
			this.history = session.history;
			this.runtimeHints = session.runtimeHints;
			printSessionTranscript(session);
			this.startInput();
			return;
		} else if (command && command !== 'start') {
			console.log(`\x1b[33m[未知参数] ${command}\x1b[0m`);
			console.log('用法：minicc [resume|--help|-V]');
		}

		this.startInput();
	}

	private async handleLine(input: string) {
		const question = input.trim();

		// slash 命令
		if (question === '/exit' || question === '/quit') {
			this.closeCli();
			return;
		}

		if (question === '/reset') {
			this.history = [];
			this.runtimeHints = [];
			this.currentSessionName = createSessionName();
			console.log('\x1b[90m[会话已重置]\x1b[0m');
			this.startInput();
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
			this.startInput();
			return;
		}

		if (question === '/help') {
			printHelp();
			this.startInput();
			return;
		}

		if (!question) {
			this.startInput();
			return;
		}

		const planQuestion = parsePlanInput(question);
		if (
			question === '/plan' ||
			(question.startsWith('/plan ') && !planQuestion)
		) {
			this.startInput();
			return;
		}

		if (question.startsWith('/')) {
			if (question !== '/' && !planQuestion) {
				console.log(`\x1b[33m[未知命令] ${question}\x1b[0m`);
			}
			if (!planQuestion) {
				this.startInput();
				return;
			}
		}

		// ── 执行 Agent Loop ────────────────────────────────────────────────────────
		resetStepCounter();

		const working = new WorkingIndicator();
		working.start();

		try {
			const userQuestion = planQuestion ?? question;
			let executionQuestion = userQuestion;
			if (planQuestion) {
				const plan = await createExecutionPlan(
					userQuestion,
					this.history,
					this.runtimeHints,
				);
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
				this.history,
				this.runtimeHints,
				{
					beforeStepLog: () => working.pause(),
					afterStepLog: () => working.resume(),
				},
			);

			const elapsedMs = working.stop();

			// 将本轮消息（含所有中间工具调用步骤）追加到 history
			this.history.push({ role: 'user', content: userQuestion });
			this.history.push(...responseMessages);
			await this.saveCurrentSession();

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
			// totalTokens 是本轮实际使用的 token 数；部分 provider 可能不返回该字段。
			if (shouldCompress(usage.totalTokens ?? 0)) {
				console.log('\n\x1b[33m[上下文接近上限，正在压缩...]\x1b[0m');
				try {
					const summary = await compressHistory(this.history);
					const hint = buildCompressionHint(summary);
					this.history = [];
					this.runtimeHints = [hint];
					await this.saveCurrentSession();
					console.log('\x1b[90m[上下文已压缩，下次对话继续]\x1b[0m');
				} catch (e) {
					console.warn(`\x1b[33m[压缩失败: ${(e as Error).message}]\x1b[0m`);
				}
			}
		} catch (e) {
			working.stop();
			console.error(`\n\x1b[31m[错误] ${(e as Error).message}\x1b[0m`);
		} finally {
			this.startInput();
		}
	}

	private async saveCurrentSession() {
		try {
			await saveSession(this.currentSessionName, {
				history: this.history,
				runtimeHints: this.runtimeHints,
			});
		} catch (e) {
			console.warn(`\x1b[33m[会话保存失败: ${(e as Error).message}]\x1b[0m`);
		}
	}

	private startInput() {
		if (this.isClosed) return;
		this.isInputActive = true;
		this.inputLine = '';
		this.renderInput();
	}

	private async submitInput() {
		if (!this.isInputActive) return;

		const submitted = this.inputLine;
		if (!submitted.trim()) {
			this.inputLine = '';
			this.renderInput();
			return;
		}

		this.clearInputArea();
		process.stdout.write(`${PROMPT_TEXT}${submitted}\n`);
		this.inputLine = '';
		this.isInputActive = false;
		await this.handleLine(submitted);
	}

	private renderInput() {
		if (!process.stdout.isTTY) return;

		this.clearInputArea();
		process.stdout.write('\x1b[?25h');
		const matches = getSlashMatches(this.inputLine);
		const lines = [
			`${PROMPT_TEXT}${this.formatInputLine(this.inputLine)}`,
			...matches.map(
				(command) =>
					`\x1b[90m${command.name.padEnd(16)} ${command.description}\x1b[0m`,
			),
		];

		process.stdout.write(lines.join('\n'));
		this.renderedInputLines = lines.length;

		if (matches.length > 0) {
			readline.moveCursor(process.stdout, 0, -matches.length);
		}
		readline.cursorTo(
			process.stdout,
			PROMPT_COLUMNS + displayWidth(this.inputLine),
		);
	}

	private formatInputLine(value: string): string {
		if (value === '/plan') return '\x1b[34m/plan\x1b[0m';
		if (value.startsWith('/plan ')) {
			return `\x1b[34m/plan\x1b[0m${value.slice('/plan'.length)}`;
		}
		return value;
	}

	private clearInputArea() {
		if (!process.stdout.isTTY || this.renderedInputLines === 0) return;

		readline.cursorTo(process.stdout, 0);
		for (let i = 0; i < this.renderedInputLines; i++) {
			readline.clearLine(process.stdout, 0);
			if (i < this.renderedInputLines - 1) {
				readline.moveCursor(process.stdout, 0, 1);
			}
		}
		if (this.renderedInputLines > 1) {
			readline.moveCursor(process.stdout, 0, -(this.renderedInputLines - 1));
		}
		readline.cursorTo(process.stdout, 0);
		this.renderedInputLines = 0;
	}

	private closeCli() {
		if (this.isClosed) return;
		this.isClosed = true;
		this.clearInputArea();
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.log('再见！');
		process.exit(0);
	}

	private closeWithoutMessage() {
		this.isClosed = true;
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.exit(0);
	}
}
