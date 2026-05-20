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
