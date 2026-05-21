import readline from 'readline';
import {
	deleteSession,
	listSessions,
	summarizeSession,
	type SavedSession,
} from '../agent/session';
import {
	displayWidth,
	extractMessageText,
	formatSessionTime,
	renderTerminalMarkdown,
	truncateByDisplayWidth,
} from './format';
import { renderInputBox } from './input-box';
import { theme } from './theme';

let isResumeScreenActive = false;

type SessionPickerMode = 'resume' | 'manage';

export async function chooseSession(): Promise<SavedSession | undefined> {
	return runSessionPicker('resume');
}

export async function manageSessions(): Promise<void> {
	await runSessionPicker('manage');
}

async function runSessionPicker(
	mode: SessionPickerMode,
): Promise<SavedSession | undefined> {
	let sessions = await listSessions();
	if (sessions.length === 0) {
		console.log('\x1b[90m[当前目录暂无历史会话]\x1b[0m');
		return undefined;
	}

	let selectedIndex = 0;
	let deleteIndex: number | undefined;

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
			if (deleteIndex !== undefined) {
				if (key?.name === 'escape' || key?.name === 'n' || key?.name === 'q') {
					deleteIndex = undefined;
					renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
					return;
				}
				if (key?.name === 'y') {
					const session = sessions[deleteIndex];
					if (!session) return;

						void deleteSelectedSession(session.name)
							.then(async () => {
								sessions = await listSessions();
								deleteIndex = undefined;
								if (sessions.length === 0) {
									finish(undefined);
									return;
								}
								selectedIndex = Math.min(selectedIndex, sessions.length - 1);
								renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
							})
							.catch((e) => {
								deleteIndex = undefined;
								renderSessionList(sessions, selectedIndex, {
									mode,
									deleteIndex,
									message: `删除失败：${(e as Error).message}`,
								});
							});
					return;
				}
				return;
			}

			if (key?.name === 'escape' || key?.name === 'q') {
				finish(undefined);
				return;
			}
			if (mode === 'resume' && key?.name === 'return') {
				finish(sessions[selectedIndex]);
				return;
			}
			if (key?.name === 'd') {
				deleteIndex = selectedIndex;
				renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
				return;
			}
			if (key?.name === 'up') {
				selectedIndex = (selectedIndex - 1 + sessions.length) % sessions.length;
				renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
				return;
			}
			if (key?.name === 'down') {
				selectedIndex = (selectedIndex + 1) % sessions.length;
				renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
			}
		};

		process.stdin.on('keypress', onKeypress);
		enterResumeScreen();
		renderSessionList(sessions, selectedIndex, { mode, deleteIndex });
	});
}

export function printSessionTranscript(session: SavedSession) {
	const transcript = buildSessionTranscript(session);
	if (!transcript) return;

	console.log(transcript);
}

interface TranscriptTurn {
	user?: string;
	assistant?: string;
	assistantFallback?: string;
}

interface TranscriptOptions {
	colors?: boolean;
	maxChars?: number;
}

export function buildSessionTranscript(
	session: SavedSession,
	options: TranscriptOptions = {},
): string {
	const turns = getTranscriptTurns(session);
	if (turns.length === 0) return '';

	const colors = options.colors ?? Boolean(process.stdout.isTTY);
	const maxChars = options.maxChars ?? 1600;
	const width = process.stdout.columns ? process.stdout.columns - 1 : undefined;
	const lines = [colors ? theme.brand('已恢复历史记录：') : '已恢复历史记录：'];

	for (const [index, turn] of turns.entries()) {
		if (index > 0) lines.push('');
		const divider = `── 第 ${index + 1} 轮 ──`;
		lines.push(colors ? theme.muted(divider) : divider);

		if (turn.user) {
			lines.push(renderInputBox(turn.user, { colors, width }).text);
		}

		const assistant = turn.assistant ?? turn.assistantFallback;
		if (assistant) {
			lines.push(colors ? theme.transcriptLabel('Agent') : 'Agent');
			lines.push(renderTranscriptBlock(assistant, maxChars, colors));
		}
	}

	lines.push('');
	return lines.join('\n');
}

function getTranscriptTurns(session: SavedSession): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	let current: TranscriptTurn | undefined;

	const flush = () => {
		if (!current) return;
		if (current.user || current.assistant || current.assistantFallback) {
			turns.push(current);
		}
		current = undefined;
	};

	for (const message of session.history) {
		if (message.role === 'user') {
			flush();
			const text = extractMessageText(message.content);
			current = text ? { user: text } : {};
			continue;
		}

		if (message.role !== 'assistant') continue;

		const text = extractMessageText(message.content);
		if (!text) continue;

		current ??= {};
		if (containsToolCall(message.content)) {
			current.assistantFallback = text;
		} else {
			current.assistant = text;
		}
	}

	flush();
	return turns;
}

function containsToolCall(content: unknown): boolean {
	if (Array.isArray(content)) return content.some(containsToolCall);
	if (!content || typeof content !== 'object') return false;

	const record = content as Record<string, unknown>;
	return record.type === 'tool-call' || typeof record.toolCallId === 'string';
}

function renderTranscriptBlock(
	text: string,
	maxChars: number,
	colors: boolean,
): string {
	const truncated = truncateMarkdownBlock(text, maxChars);
	return renderTerminalMarkdown(truncated, { colors });
}

function truncateMarkdownBlock(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `${trimmed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

async function deleteSelectedSession(name: string) {
	await deleteSession(name);
}

interface SessionListRenderOptions {
	mode?: SessionPickerMode;
	colors?: boolean;
	width?: number;
	deleteIndex?: number;
	message?: string;
}

export function renderSessionListLines(
	sessions: SavedSession[],
	selectedIndex: number,
	options: SessionListRenderOptions = {},
): string[] {
	const mode = options.mode ?? 'resume';
	const colors = options.colors ?? Boolean(process.stdout.isTTY);
	const maxWidth = Math.max(
		40,
		(options.width ?? process.stdout.columns ?? 80) - 1,
	);
	const title =
		mode === 'resume' ? '选择要恢复的会话' : '管理历史会话';
	const help =
		mode === 'resume'
			? '↑/↓ 选择，Enter 恢复，d 删除，q 取消'
			: '↑/↓ 选择，d 删除，q 返回';
	return [
		styleListLine(title, 'title', colors, maxWidth),
		styleListLine(help, 'muted', colors, maxWidth),
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
			return index === selectedIndex && colors
				? `\x1b[7m${clipped}\x1b[0m`
				: clipped;
		}),
		...(options.deleteIndex !== undefined
			? [
					styleListLine(
						'确认删除该会话？按 y 删除，n 取消',
						'danger',
						colors,
						maxWidth,
					),
				]
			: []),
		...(options.message
			? [styleListLine(options.message, 'warning', colors, maxWidth)]
			: []),
	];
}

function renderSessionList(
	sessions: SavedSession[],
	selectedIndex: number,
	options: SessionListRenderOptions = {},
) {
	const lines = renderSessionListLines(sessions, selectedIndex, {
		...options,
		colors: true,
	});

	if (process.stdout.isTTY) {
		process.stdout.write('\x1b[H\x1b[2J');
	}
	process.stdout.write(lines.join('\n'));
}

function styleListLine(
	value: string,
	style: 'title' | 'muted' | 'danger' | 'warning',
	colors: boolean,
	width: number,
): string {
	const text = truncateByDisplayWidth(value, width);
	if (!colors) return text;

	if (style === 'title') return `\x1b[1m${text}\x1b[0m`;
	if (style === 'muted') return `\x1b[90m${text}\x1b[0m`;
	if (style === 'danger') return `\x1b[31m${text}\x1b[0m`;
	return `\x1b[33m${text}\x1b[0m`;
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
}
