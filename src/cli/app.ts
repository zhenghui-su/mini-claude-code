import readline from 'readline';
import type { ModelMessage } from 'ai';
import {
	agentLoop,
	createExecutionPlan,
	resetStepCounter,
} from '../agent/loop';
import {
	compactContext,
	createContextSnapshot,
	recordUsage,
	shouldCompress,
	type CompressionReason,
	type ContextSnapshot,
} from '../agent/context';
import {
	createSessionName,
	listSessions,
	saveSession,
	summarizeSession,
} from '../agent/session';
import { confirmQuestion } from '../utils/confirm';
import packageJson from '../../package.json';
import {
	displayWidth,
	formatContextReport,
	formatDuration,
	formatSessionTime,
	getContextUsageDisplay,
	renderHudLine,
	renderTerminalMarkdown,
	truncateByDisplayWidth,
} from './format';
import { printCliHelp, printHelp } from './help';
import { renderInputBox } from './input-box';
import { chooseSession, printSessionTranscript } from './resume';
import {
	completeSlashInput,
	getSlashMatches,
	moveSlashSelection,
	normalizeSlashSelection,
	parsePlanInput,
} from './slash';
import { theme } from './theme';
import { WorkingIndicator } from './working-indicator';

export async function runCli() {
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}

	const app = new CliApp();
	process.stdin.on('keypress', app.handleKeypress);
	process.stdout.on('resize', app.handleResize);
	await app.bootstrap();
}

class CliApp {
	// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
	private history: ModelMessage[] = [];
	// 分层上下文状态（模型、token 用量、压缩摘要、工作记忆等）
	private context: ContextSnapshot = createContextSnapshot();
	private currentSessionName = createSessionName();
	private inputLine = '';
	private renderedInputLineWidths: number[] = [];
	private renderedInputCursorLine = 0;
	private renderedInputCursorColumn = 0;
	private isInputActive = false;
	private isClosed = false;
	private selectedSlashIndex = 0;

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

		if (this.isSlashPickerOpen() && key?.name === 'up') {
			this.selectedSlashIndex = moveSlashSelection(
				this.inputLine,
				this.selectedSlashIndex,
				-1,
			);
			this.renderInput();
			return;
		}

		if (this.isSlashPickerOpen() && key?.name === 'down') {
			this.selectedSlashIndex = moveSlashSelection(
				this.inputLine,
				this.selectedSlashIndex,
				1,
			);
			this.renderInput();
			return;
		}

		if (this.isSlashPickerOpen() && key?.name === 'tab') {
			const completed = completeSlashInput(
				this.inputLine,
				this.selectedSlashIndex,
			);
			if (completed) {
				this.inputLine = completed;
				this.selectedSlashIndex = 0;
				this.renderInput();
			}
			return;
		}

		if (key?.name === 'backspace') {
			this.inputLine = this.inputLine.slice(0, -1);
			this.selectedSlashIndex = 0;
			this.renderInput();
			return;
		}

		if (key?.ctrl && key.name === 'u') {
			this.inputLine = '';
			this.selectedSlashIndex = 0;
			this.renderInput();
			return;
		}

		if (char && !key?.ctrl && !key?.meta) {
			this.inputLine += char;
			this.selectedSlashIndex = 0;
			this.renderInput();
		}
	};

	handleResize = () => {
		if (!this.isInputActive || this.isClosed) return;
		this.renderInput();
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
			`${theme.brand('mini-claude-code')} ${theme.muted(`v${packageJson.version} — 输入 /help 查看帮助`)}`,
		);

		if (command === 'resume') {
			const session = await chooseSession();
			if (!session) {
				this.closeWithoutMessage();
				return;
			}

			this.currentSessionName = session.name;
			this.history = session.history;
			this.context = session.context;
			printSessionTranscript(session);
			this.startInput();
			return;
		} else if (command && command !== 'start') {
			console.log(theme.warningStatus(`未知参数: ${command}`));
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
			this.context = createContextSnapshot();
			this.currentSessionName = createSessionName();
			console.log(theme.status('会话已重置'));
			this.startInput();
			return;
		}

		if (question === '/sessions') {
			const sessions = await listSessions();
			if (sessions.length === 0) {
				console.log(theme.status('暂无已保存会话'));
			} else {
				console.log(`\n${theme.brand('已保存会话：')}`);
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

		if (question === '/context') {
			this.printContextDetails();
			this.startInput();
			return;
		}

		if (question === '/compact') {
			try {
				const result = await this.runCompaction('manual');
				console.log(
					theme.status(
						`上下文已压缩：${result.previousMessageCount} 条消息 -> 1 份摘要`,
					),
				);
			} catch (e) {
				console.log(theme.warningStatus(`压缩失败: ${(e as Error).message}`));
			}
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
				console.log(theme.warningStatus(`未知命令: ${question}`));
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
					this.context,
				);
				working.pause();
				console.log(
					`\n${theme.info('── 执行计划 ─────────────────────────────────────')}`,
				);
				console.log(renderTerminalMarkdown(plan));

				const approved = await confirmQuestion('\n按计划执行? (y/N) ');
				if (!approved) {
					working.stop();
					console.log(theme.status('已取消执行'));
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
				this.context,
				{
					beforeStepLog: () => working.pause(),
					afterStepLog: () => working.resume(),
				},
			);

			const elapsedMs = working.stop();

			// 将本轮消息（含所有中间工具调用步骤）追加到 history
			this.history.push({ role: 'user', content: userQuestion });
			this.history.push(...responseMessages);
			this.context = recordUsage(this.context, usage);
			await this.saveCurrentSession();

			// 有工具调用（多步）时才打印分隔线，纯文本回答直接输出，避免重复
			if (stepCount > 1) {
				console.log(
					`\n${theme.info('── 最终回答 ─────────────────────────────────────')}`,
				);
			}
			console.log(renderTerminalMarkdown(text));
			console.log(
				`\n${theme.muted(`─ Worked for ${formatDuration(elapsedMs)} ──`)}`,
			);

			// ── 上下文压缩检查（基于本轮 prompt tokens 判断）────────────────────────
			if (
				shouldCompress(
					this.context.lastPromptTokens ?? 0,
					this.context.contextLimit,
				)
			) {
				console.log(`\n${theme.warningStatus('上下文接近上限，正在压缩...')}`);
				try {
					const result = await this.runCompaction('threshold');
					console.log(
						theme.status(
							`上下文已自动压缩：${result.previousMessageCount} 条消息 -> 1 份摘要`,
						),
					);
				} catch (e) {
					console.warn(
						theme.warningStatus(`压缩失败: ${(e as Error).message}`),
					);
				}
			}
		} catch (e) {
			working.stop();
			console.error(`\n${theme.errorStatus(`错误: ${(e as Error).message}`)}`);
		} finally {
			this.startInput();
		}
	}

	private async saveCurrentSession() {
		try {
			await saveSession(this.currentSessionName, {
				history: this.history,
				context: this.context,
			});
		} catch (e) {
			console.warn(
				theme.warningStatus(`会话保存失败: ${(e as Error).message}`),
			);
		}
	}

	private startInput() {
		if (this.isClosed) return;
		this.isInputActive = true;
		this.inputLine = '';
		this.selectedSlashIndex = 0;
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
		process.stdout.write(`${renderInputBox(submitted).text}\n`);
		this.inputLine = '';
		this.selectedSlashIndex = 0;
		this.isInputActive = false;
		await this.handleLine(submitted);
	}

	private renderInput() {
		if (!process.stdout.isTTY) return;

		this.clearInputArea();
		process.stdout.write('\x1b[?25h');
		const matches = getSlashMatches(this.inputLine);
		this.selectedSlashIndex = normalizeSlashSelection(
			this.inputLine,
			this.selectedSlashIndex,
		);
		const inputBox = renderInputBox(this.inputLine);
		const isSlashMode = this.isSlashMode();
		const extraLines = isSlashMode
			? matches.map((command, index) =>
					this.formatSlashMatchLine(
						command.name,
						command.description,
						index === this.selectedSlashIndex,
					),
				)
			: [this.buildHudLine()];
		const lines = [...inputBox.lines, ...extraLines];
		const lineWidths = lines.map(visibleTextWidth);

		process.stdout.write(lines.join('\n'));
		this.renderedInputLineWidths = lineWidths;
		this.renderedInputCursorLine = inputBox.cursorLineIndex;
		this.renderedInputCursorColumn = inputBox.cursorColumn;

		const layout = measureRenderLayout(
			lineWidths,
			inputBox.cursorLineIndex,
			inputBox.cursorColumn,
			process.stdout.columns ?? 80,
		);
		const linesBelowInput = layout.totalRows - 1 - layout.cursorRow;
		if (linesBelowInput > 0) {
			readline.moveCursor(process.stdout, 0, -linesBelowInput);
		}
		readline.cursorTo(process.stdout, layout.cursorColumn);
	}

	private isSlashMode(): boolean {
		return this.inputLine.trimStart().startsWith('/');
	}

	private isSlashPickerOpen(): boolean {
		return getSlashMatches(this.inputLine).length > 0;
	}

	private formatSlashMatchLine(
		name: string,
		description: string,
		selected: boolean,
	): string {
		const maxWidth = Math.max(1, (process.stdout.columns ?? 80) - 1);
		const line = truncateByDisplayWidth(
			`${name.padEnd(16)} ${description}`,
			maxWidth,
		);
		return selected ? theme.commandSelected(line) : theme.muted(line);
	}

	private buildHudLine(): string {
		return renderHudLine({
			modelId: this.context.modelId,
			cwd: process.cwd(),
			usage: this.getContextUsage(),
			width: process.stdout.columns ?? 80,
		});
	}

	private getContextUsage() {
		return getContextUsageDisplay(
			this.context.lastPromptTokens,
			this.context.contextLimit,
		);
	}

	private printContextDetails() {
		console.log('');
		console.log(
			renderTerminalMarkdown(
				formatContextReport(this.context, this.history.length, process.cwd()),
			),
		);
		console.log('');
	}

	private async runCompaction(reason: CompressionReason) {
		const result = await compactContext({
			history: this.history,
			context: this.context,
			reason,
		});
		this.history = result.history;
		this.context = result.context;
		await this.saveCurrentSession();
		return result;
	}

	private clearInputArea() {
		if (!process.stdout.isTTY || this.renderedInputLineWidths.length === 0) return;

		const layout = measureRenderLayout(
			this.renderedInputLineWidths,
			this.renderedInputCursorLine,
			this.renderedInputCursorColumn,
			process.stdout.columns ?? 80,
		);
		if (layout.cursorRow > 0) {
			readline.moveCursor(process.stdout, 0, -layout.cursorRow);
		}
		readline.cursorTo(process.stdout, 0);
		const rowsToClear = layout.totalRows + 4;
		for (let i = 0; i < rowsToClear; i++) {
			readline.clearLine(process.stdout, 0);
			if (i < rowsToClear - 1) {
				readline.moveCursor(process.stdout, 0, 1);
			}
		}
		if (rowsToClear > 1) {
			readline.moveCursor(process.stdout, 0, -(rowsToClear - 1));
		}
		readline.cursorTo(process.stdout, 0);
		this.renderedInputLineWidths = [];
		this.renderedInputCursorLine = 0;
		this.renderedInputCursorColumn = 0;
	}

	private closeCli() {
		if (this.isClosed) return;
		this.isClosed = true;
		this.clearInputArea();
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.log(theme.muted('再见！'));
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

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

function visibleTextWidth(text: string): number {
	return displayWidth(text.replace(ANSI_ESCAPE_REGEX, ''));
}

function measureRenderLayout(
	lineWidths: number[],
	cursorLineIndex: number,
	cursorColumn: number,
	columns: number,
): {
	totalRows: number;
	cursorRow: number;
	cursorColumn: number;
} {
	const safeColumns = Math.max(1, columns);
	const widths = lineWidths.map((width) => Math.max(1, width));
	const rowsPerLine = widths.map((width) =>
		Math.max(1, Math.ceil(width / safeColumns)),
	);
	const safeCursorLineIndex = Math.min(
		Math.max(0, cursorLineIndex),
		Math.max(0, widths.length - 1),
	);
	const cursorLineWidth = widths[safeCursorLineIndex] ?? 1;
	const cursorLineRows = rowsPerLine[safeCursorLineIndex] ?? 1;
	const safeCursorColumn = Math.min(Math.max(0, cursorColumn), cursorLineWidth);
	const cursorRowOffset = Math.min(
		cursorLineRows - 1,
		Math.floor(safeCursorColumn / safeColumns),
	);
	const rowsBeforeCursor = rowsPerLine
		.slice(0, safeCursorLineIndex)
		.reduce((sum, value) => sum + value, 0);
	const totalRows = rowsPerLine.reduce((sum, value) => sum + value, 0);

	return {
		totalRows,
		cursorRow: rowsBeforeCursor + cursorRowOffset,
		cursorColumn: safeCursorColumn % safeColumns,
	};
}
