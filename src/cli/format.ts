import type { ContextSnapshot } from '../agent/context';
import { theme } from './theme';

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

export function formatSessionTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;

	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTokenCount(value: number): string {
	if (value >= 100_000) return `${Math.round(value / 1000)}k`;
	if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
	if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`;
	return String(value);
}

export function formatCwdPath(value: string): string {
	const home = process.env.HOME;
	if (home && value.startsWith(home)) {
		return `~${value.slice(home.length) || '/'}`;
	}

	return value;
}

export function getUsageRing(percent: number): string {
	const normalized = Math.max(0, Math.min(100, Math.round(percent)));
	if (normalized === 0) return '○';
	if (normalized < 25) return '◔';
	if (normalized < 50) return '◑';
	if (normalized < 75) return '◕';
	return '◉';
}

export interface ContextUsageDisplay {
	ring: string;
	percent: number;
	used: string;
	limit: string;
}

export function getContextUsageDisplay(
	lastPromptTokens: number | undefined,
	contextLimit: number,
): ContextUsageDisplay {
	const promptTokens = Math.max(0, lastPromptTokens ?? 0);
	const safeLimit = Math.max(1, contextLimit);
	const percent = Math.min(100, Math.round((promptTokens / safeLimit) * 100));

	return {
		ring: getUsageRing(percent),
		percent,
		used: formatTokenCount(promptTokens),
		limit: formatTokenCount(safeLimit),
	};
}

export interface HudLineOptions {
	modelId: string;
	cwd: string;
	usage: ContextUsageDisplay;
	colors?: boolean;
	width?: number;
}

export function renderHudLine(options: HudLineOptions): string {
	const colors = options.colors ?? Boolean(process.stdout.isTTY);
	const maxWidth = Math.max(1, (options.width ?? process.stdout.columns ?? 80) - 1);
	const modelValue = truncateByDisplayWidth(options.modelId, 18);
	const contextText = `${options.usage.ring} ${options.usage.percent}% ${options.usage.used}/${options.usage.limit}`;
	const separators = '  ';
	const pathValueMaxWidth = Math.max(
		1,
		maxWidth -
			displayWidth(modelValue) -
			displayWidth(contextText) -
			displayWidth(separators) * 2,
	);
	const pathValue = truncateByDisplayWidth(
		formatCwdPath(options.cwd),
		pathValueMaxWidth,
	);
	const plain = [modelValue, pathValue, contextText].join(separators);
	const padding = ' '.repeat(Math.max(0, maxWidth - displayWidth(plain)));
	const styled = [
		theme.hudValue(modelValue),
		theme.hudPathValue(pathValue),
		`${theme.usage(
			options.usage.percent,
			`${options.usage.ring} ${options.usage.percent}%`,
		)} ${theme.hudValue(`${options.usage.used}/${options.usage.limit}`)}`,
	].join(separators);

	if (!colors) return `${padding}${plain}`;
	return `${padding}${styled}`;
}

export function formatContextReport(
	context: ContextSnapshot,
	historyCount: number,
	cwd: string,
): string {
	const usage = getContextUsageDisplay(
		context.lastPromptTokens,
		context.contextLimit,
	);
	const lastRequest =
		typeof context.lastTotalTokens === 'number'
			? `prompt \`${usage.used}\`，total \`${formatTokenCount(context.lastTotalTokens)}\``
			: '尚未发送任何请求';

	const lines = [
		'## 当前上下文',
		'',
		`- 模型：\`${context.modelId}\``,
		`- 路径：\`${cwd}\``,
		`- 上下文：\`${usage.ring} ${usage.percent}%\`（\`${usage.used} / ${usage.limit}\`）`,
		`- 最近一次请求：${lastRequest}`,
		'',
		'### 会话状态',
		'',
		`- 历史消息：\`${historyCount}\``,
		`- 会话摘要：${context.sessionSummary ? '`已生成`' : '`无`'}`,
		`- 工作记忆：\`${context.workingMemory.length}\``,
		`- 用户约束：\`${context.userConstraints.length}\``,
		`- 压缩次数：\`${context.compressionCount}\``,
		`- 最近压缩：${
			context.lastCompressedAt ? `\`${context.lastCompressedAt}\`` : '`未发生`'
		}`,
	];

	if (context.workingMemory.length > 0) {
		lines.push('', '### 工作记忆', '');
		lines.push(...context.workingMemory.map((line) => `- ${line}`));
	}

	if (context.userConstraints.length > 0) {
		lines.push('', '### 用户约束', '');
		lines.push(...context.userConstraints.map((line) => `- ${line}`));
	}

	return lines.join('\n');
}

interface TerminalMarkdownOptions {
	colors?: boolean;
	width?: number;
}

const terminalStyles = {
	bold: ['\x1b[1m', '\x1b[22m'],
	dim: ['\x1b[2m', '\x1b[22m'],
	italic: ['\x1b[3m', '\x1b[23m'],
	strike: ['\x1b[9m', '\x1b[29m'],
	cyan: ['\x1b[36m', '\x1b[39m'],
	boldCyan: ['\x1b[1m\x1b[36m', '\x1b[39m\x1b[22m'],
} as const;

export function renderTerminalMarkdown(
	markdown: string,
	options: TerminalMarkdownOptions = {},
): string {
	const colors = options.colors ?? Boolean(process.stdout.isTTY);
	const width = Math.max(20, options.width ?? process.stdout.columns ?? 80);
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const rendered: string[] = [];
	let inCodeFence = false;

	for (const rawLine of lines) {
		const line = rawLine.replace(/\s+$/u, '');

		if (/^\s*```/u.test(line)) {
			inCodeFence = !inCodeFence;
			continue;
		}

		if (inCodeFence) {
			rendered.push(paint(`  ${rawLine}`, terminalStyles.dim, colors));
			continue;
		}

		rendered.push(renderTerminalMarkdownLine(line, colors, width));
	}

	return rendered.join('\n').trimEnd();
}

function renderTerminalMarkdownLine(
	line: string,
	colors: boolean,
	width: number,
): string {
	if (!line.trim()) return '';

	const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
	if (heading) {
		const level = heading[1]?.length ?? 1;
		const text = renderTerminalInline(heading[2] ?? '', colors);
		if (level <= 2) return paint(text, terminalStyles.boldCyan, colors);
		if (level === 3) return paint(text, terminalStyles.bold, colors);
		return paint(text, terminalStyles.dim, colors);
	}

	if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
		return paint('─'.repeat(Math.min(width, 80)), terminalStyles.dim, colors);
	}

	const quote = line.match(/^\s*>\s?(.*)$/u);
	if (quote) {
		return `${paint('│', terminalStyles.dim, colors)} ${paint(
			renderTerminalInline(quote[1] ?? '', colors),
			terminalStyles.dim,
			colors,
		)}`;
	}

	const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/u);
	if (task) {
		const marker = task[2]?.toLowerCase() === 'x' ? '☑' : '☐';
		return `${task[1] ?? ''}${paint(marker, terminalStyles.cyan, colors)} ${renderTerminalInline(task[3] ?? '', colors)}`;
	}

	const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/u);
	if (unordered) {
		return `${unordered[1] ?? ''}${paint('•', terminalStyles.cyan, colors)} ${renderTerminalInline(unordered[2] ?? '', colors)}`;
	}

	const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/u);
	if (ordered) {
		return `${ordered[1] ?? ''}${paint(`${ordered[2]}.`, terminalStyles.cyan, colors)} ${renderTerminalInline(ordered[3] ?? '', colors)}`;
	}

	if (isMarkdownTableSeparator(line)) return '';

	const tableCells = splitMarkdownTableRow(line);
	if (tableCells) {
		return tableCells.map((cell) => renderTerminalInline(cell, colors)).join(
			paint('  │  ', terminalStyles.dim, colors),
		);
	}

	return renderTerminalInline(line, colors);
}

function renderTerminalInline(text: string, colors: boolean): string {
	const codeSpans: string[] = [];
	let rendered = text.replace(/`([^`\n]+)`/gu, (_match, code: string) => {
		const index = codeSpans.push(paint(code, terminalStyles.cyan, colors)) - 1;
		return `\uE000${index}\uE000`;
	});

	rendered = rendered
		.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (_match, alt: string, url: string) =>
			alt ? `${alt} (${url})` : url,
		)
		.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label: string, url: string) =>
			label === url ? url : `${label} (${url})`,
		)
		.replace(/\*\*([^*\n]+)\*\*/gu, (_match, value: string) =>
			paint(value, terminalStyles.bold, colors),
		)
		.replace(/__([^_\n]+)__/gu, (_match, value: string) =>
			paint(value, terminalStyles.bold, colors),
		)
		.replace(/\*([^*\n]+)\*/gu, (_match, value: string) =>
			paint(value, terminalStyles.italic, colors),
		)
		.replace(/~~([^~\n]+)~~/gu, (_match, value: string) =>
			paint(value, terminalStyles.strike, colors),
		);

	return rendered.replace(/\uE000(\d+)\uE000/gu, (_match, index: string) => {
		return codeSpans[Number(index)] ?? '';
	});
}

function splitMarkdownTableRow(line: string): string[] | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;

	const cells = trimmed
		.slice(1, -1)
		.split('|')
		.map((cell) => cell.trim());

	return cells.length > 1 ? cells : undefined;
}

function isMarkdownTableSeparator(line: string): boolean {
	const cells = splitMarkdownTableRow(line);
	return Boolean(
		cells &&
			cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, ''))),
	);
}

function paint(
	text: string,
	style: readonly [string, string],
	enabled: boolean,
): string {
	if (!enabled || text.length === 0) return text;
	return `${style[0]}${text}${style[1]}`;
}

export function extractMessageText(content: unknown): string {
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

export function truncateDisplay(text: string, maxChars: number): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	return compact.length > maxChars
		? `${compact.slice(0, maxChars - 1)}…`
		: compact;
}

export function truncateByDisplayWidth(text: string, maxWidth: number): string {
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

export function displayWidth(text: string): number {
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
