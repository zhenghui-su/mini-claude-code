export interface ToolResult<T = unknown> {
	ok: boolean;
	message: string;
	data?: T;
}

export function ok<T>(message: string, data?: T): ToolResult<T> {
	return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

export function fail(message: string): ToolResult {
	return { ok: false, message };
}

export function getToolResultMessage(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	if (!('message' in value)) return undefined;

	const message = (value as { message?: unknown }).message;
	return typeof message === 'string' ? message : undefined;
}
