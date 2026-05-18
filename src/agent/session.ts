import { mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import type { ModelMessage } from 'ai';
import { isSensitivePath } from '../utils/safety';

export interface SessionState {
	history: ModelMessage[];
	runtimeHints: string[];
}

export interface SavedSession extends SessionState {
	name: string;
	createdAt: string;
	updatedAt: string;
	cwd: string;
	lastReplyPreview: string;
}

export interface SessionSummary {
	name: string;
	createdAt: string;
	updatedAt: string;
	cwd: string;
	lastReplyPreview: string;
}

export async function saveSession(
	name: string,
	state: SessionState,
): Promise<SavedSession> {
	await mkdir(sessionDir(), { recursive: true });

	const safeName = normalizeSessionName(name);
	const path = sessionPath(safeName);
	const existing = await readSessionFile(path);
	const now = new Date().toISOString();
	const session: SavedSession = {
		name: safeName,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		cwd: process.cwd(),
		lastReplyPreview: getLastReplyPreview(state.history),
		history: sanitizeHistory(state.history),
		runtimeHints: state.runtimeHints,
	};

	await Bun.write(path, JSON.stringify(session, null, 2));
	return session;
}

export async function loadSession(name: string): Promise<SavedSession> {
	const safeName = normalizeSessionName(name);
	const path = sessionPath(safeName);
	const file = Bun.file(path);

	if (!(await file.exists())) {
		throw new Error(`会话不存在：${safeName}`);
	}

	return JSON.parse(await file.text()) as SavedSession;
}

export async function listSessions(): Promise<SavedSession[]> {
	const dir = sessionDir();
	await mkdir(dir, { recursive: true });
	const files = await readdir(dir);
	const sessions = await Promise.all(
		files
			.filter((file) => file.endsWith('.json'))
			.map((file) => readSessionFile(join(dir, file))),
	);

	return sessions
		.filter((session): session is SavedSession => Boolean(session))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createSessionName(): string {
	return defaultSessionName();
}

export function summarizeSession(session: SavedSession): SessionSummary {
	return {
		name: session.name,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		cwd: session.cwd,
		lastReplyPreview: session.lastReplyPreview || getLastReplyPreview(session.history),
	};
}

function normalizeSessionName(name: string): string {
	const trimmed = name.trim() || defaultSessionName();
	const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
	return safe.slice(0, 64) || defaultSessionName();
}

function defaultSessionName(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function sessionPath(name: string): string {
	return join(sessionDir(), `${name}.json`);
}

function sessionDir(): string {
	return join(process.cwd(), '.mini-claude', 'sessions');
}

async function readSessionFile(path: string): Promise<SavedSession | undefined> {
	const file = Bun.file(path);
	if (!(await file.exists())) return undefined;

	try {
		const parsed = JSON.parse(await file.text()) as Partial<SavedSession>;
		if (!parsed.name || !parsed.createdAt || !parsed.updatedAt) return undefined;

		return {
			name: parsed.name,
			createdAt: parsed.createdAt,
			updatedAt: parsed.updatedAt,
			cwd: parsed.cwd ?? process.cwd(),
			lastReplyPreview:
				parsed.lastReplyPreview ?? getLastReplyPreview(parsed.history ?? []),
			history: parsed.history ?? [],
			runtimeHints: parsed.runtimeHints ?? [],
		};
	} catch {
		return undefined;
	}
}

function sanitizeHistory(history: ModelMessage[]): ModelMessage[] {
	return history.map((message) => sanitizeValue(message) as ModelMessage);
}

function sanitizeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sanitizeValue);
	if (!value || typeof value !== 'object') return value;

	const record = value as Record<string, unknown>;
	const copy: Record<string, unknown> = {};
	const path =
		typeof record.path === 'string'
			? record.path
			: typeof record.url === 'string'
				? record.url
				: undefined;
	const sensitive = path ? isSensitivePath(path) : false;

	for (const [key, entry] of Object.entries(record)) {
		if (sensitive && (key === 'content' || key === 'output')) {
			copy[key] = '[已脱敏：敏感路径内容不写入会话文件]';
			continue;
		}
		copy[key] = sanitizeValue(entry);
	}

	return copy;
}

function getLastReplyPreview(history: ModelMessage[]): string {
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (message?.role !== 'assistant') continue;

		const text = extractText(message.content).replace(/\s+/g, ' ').trim();
		if (text) return truncatePreview(text);
	}

	return '暂无回复';
}

function extractText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map(extractText).join(' ');
	if (!content || typeof content !== 'object') return '';

	const record = content as Record<string, unknown>;
	if (typeof record.text === 'string') return record.text;
	if (typeof record.content === 'string') return record.content;
	return '';
}

function truncatePreview(text: string): string {
	return text.length > 36 ? `${text.slice(0, 35)}…` : text;
}
