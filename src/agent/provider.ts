import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';

export const MODEL_ID = 'deepseek-chat';
const DEFAULT_PROFILE_CONTEXT_LIMIT = 128_000;

export const MODEL_PROVIDER_KINDS = [
	'deepseek',
	'openai',
	'anthropic',
	'openai-compatible',
	'anthropic-compatible',
] as const;

export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];

export interface ModelProfile {
	id: string;
	provider: ModelProviderKind;
	modelId: string;
	baseURL?: string;
	apiKey?: string;
	contextLimit: number;
	createdAt?: string;
	updatedAt?: string;
}

interface StoredModelFile {
	models?: Partial<ModelProfile>[];
}

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_OPENAI_MODEL_ID = 'gpt-5.5';
const DEFAULT_ANTHROPIC_MODEL_ID = 'claude-sonnet-4-6';

export async function listModelProfiles(): Promise<ModelProfile[]> {
	const profiles = new Map<string, ModelProfile>();

	for (const profile of getBuiltinModelProfiles()) {
		profiles.set(profile.id, profile);
	}
	for (const profile of await readStoredModelProfiles()) {
		profiles.set(profile.id, profile);
	}

	return [...profiles.values()];
}

export async function listUsableModelProfiles(): Promise<ModelProfile[]> {
	return (await listModelProfiles()).filter(hasModelCredential);
}

export async function getModelProfile(
	id: string,
): Promise<ModelProfile | undefined> {
	const normalized = normalizeModelProfileId(id);
	const profiles = await listModelProfiles();
	return profiles.find((profile) => profile.id === normalized);
}

export async function addModelProfile(
	profile: Partial<ModelProfile>,
): Promise<ModelProfile> {
	const next = normalizeModelProfile({
		...profile,
		updatedAt: new Date().toISOString(),
		createdAt: profile.createdAt ?? new Date().toISOString(),
	});
	const existing = await readStoredModelProfiles();
	const merged = existing.filter((item) => item.id !== next.id);
	merged.push(next);
	await writeStoredModelProfiles(merged);
	return next;
}

export async function deleteModelProfile(id: string): Promise<boolean> {
	const normalized = normalizeModelProfileId(id);
	const existing = await readStoredModelProfiles();
	const next = existing.filter((profile) => profile.id !== normalized);
	if (next.length === existing.length) return false;

	await writeStoredModelProfiles(next);
	return true;
}

export async function isStoredModelProfile(id: string): Promise<boolean> {
	const normalized = normalizeModelProfileId(id);
	const existing = await readStoredModelProfiles();
	return existing.some((profile) => profile.id === normalized);
}

export async function listStoredModelProfileIds(): Promise<Set<string>> {
	const existing = await readStoredModelProfiles();
	return new Set(existing.map((profile) => profile.id));
}

export async function resolveLanguageModel(
	id: string = MODEL_ID,
): Promise<LanguageModel> {
	const profile = await getModelProfile(id);
	if (!profile) {
		throw new Error(
			`模型不存在：${id}。请使用 /model 打开模型选择器新增或切换模型。`,
		);
	}

	const credential = getModelCredential(profile);
	if (!credential.apiKey && !credential.authToken) {
		throw new Error(
			`模型 ${profile.id} 缺少 API Key。请使用 /model 新增配置，或设置对应环境变量。`,
		);
	}

	switch (profile.provider) {
		case 'deepseek':
			return createDeepSeek({
				apiKey: credential.apiKey,
				baseURL: profile.baseURL || DEFAULT_DEEPSEEK_BASE_URL,
			})(profile.modelId);
		case 'openai':
		case 'openai-compatible':
			return createOpenAI({
				apiKey: credential.apiKey,
				baseURL: profile.baseURL || undefined,
				name:
					profile.provider === 'openai-compatible'
						? `openai-compatible.${profile.id}`
						: undefined,
			})(profile.modelId);
		case 'anthropic':
		case 'anthropic-compatible':
			return createAnthropic({
				apiKey: credential.apiKey,
				authToken: credential.authToken,
				baseURL: profile.baseURL || undefined,
				name:
					profile.provider === 'anthropic-compatible'
						? `anthropic-compatible.${profile.id}`
						: undefined,
			})(profile.modelId);
		default:
			return assertNever(profile.provider);
	}
}

export function normalizeModelProfile(
	profile: Partial<ModelProfile>,
): ModelProfile {
	const provider = normalizeProviderKind(profile.provider);
	const modelId = profile.modelId?.trim();
	if (!modelId) throw new Error('模型 ID 不能为空');

	const id = normalizeModelProfileId(
		profile.id?.trim() || `${provider}:${modelId}`,
	);
	const contextLimit = normalizeContextLimit(profile.contextLimit);

	return {
		id,
		provider,
		modelId,
		baseURL: cleanOptional(profile.baseURL),
		apiKey: cleanOptional(profile.apiKey),
		contextLimit,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
	};
}

export function normalizeModelProfileId(value: string): string {
	const normalized = value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^a-zA-Z0-9:._-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-:.]+|[-:.]+$/g, '');

	if (!normalized) throw new Error('模型名称不能为空');
	return normalized.slice(0, 80);
}

export function isModelProviderKind(value: string): value is ModelProviderKind {
	return MODEL_PROVIDER_KINDS.includes(value as ModelProviderKind);
}

export function hasModelCredential(profile: ModelProfile): boolean {
	const credential = getModelCredential(profile);
	return Boolean(credential.apiKey || credential.authToken);
}

export function getModelBaseURL(profile: ModelProfile): string | undefined {
	if (profile.baseURL) return profile.baseURL;
	if (profile.provider === 'deepseek') return DEFAULT_DEEPSEEK_BASE_URL;
	return undefined;
}

function getBuiltinModelProfiles(): ModelProfile[] {
	const profiles: ModelProfile[] = [];

	if (process.env.OPENAI_API_KEY) {
		const modelId = process.env.OPENAI_MODEL_ID || DEFAULT_OPENAI_MODEL_ID;
		profiles.push(
			normalizeModelProfile({
				id: `openai:${modelId}`,
				provider: 'openai',
				modelId,
				baseURL: process.env.OPENAI_API_BASE_URL,
				apiKey: process.env.OPENAI_API_KEY,
				contextLimit: DEFAULT_PROFILE_CONTEXT_LIMIT,
			}),
		);
	}

	if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
		const modelId =
			process.env.ANTHROPIC_MODEL_ID || DEFAULT_ANTHROPIC_MODEL_ID;
		profiles.push(
			normalizeModelProfile({
				id: `anthropic:${modelId}`,
				provider: 'anthropic',
				modelId,
				baseURL: process.env.ANTHROPIC_BASE_URL,
				apiKey: process.env.ANTHROPIC_API_KEY,
				contextLimit: DEFAULT_PROFILE_CONTEXT_LIMIT,
			}),
		);
	}

	return profiles;
}

async function readStoredModelProfiles(): Promise<ModelProfile[]> {
	const file = Bun.file(modelConfigPath());
	if (!(await file.exists())) return [];

	try {
		const parsed = JSON.parse(await file.text()) as StoredModelFile;
		return (parsed.models ?? []).map((profile) => normalizeModelProfile(profile));
	} catch {
		return [];
	}
}

async function writeStoredModelProfiles(
	profiles: ModelProfile[],
): Promise<void> {
	await mkdir(modelConfigDir(), { recursive: true });
	await Bun.write(
		modelConfigPath(),
		JSON.stringify({ models: profiles.map(stripEmptyFields) }, null, 2),
	);
}

function stripEmptyFields(profile: ModelProfile): ModelProfile {
	const clean = { ...profile };
	if (!clean.baseURL) delete clean.baseURL;
	if (!clean.apiKey) delete clean.apiKey;
	if (!clean.createdAt) delete clean.createdAt;
	if (!clean.updatedAt) delete clean.updatedAt;
	return clean;
}

function getModelCredential(profile: ModelProfile): {
	apiKey?: string;
	authToken?: string;
} {
	if (profile.apiKey) return { apiKey: profile.apiKey };

	switch (profile.provider) {
		case 'deepseek':
			return { apiKey: process.env.DEEPSEEK_API_KEY };
		case 'openai':
			return { apiKey: process.env.OPENAI_API_KEY };
		case 'anthropic':
			return {
				apiKey: process.env.ANTHROPIC_API_KEY,
				authToken: process.env.ANTHROPIC_AUTH_TOKEN,
			};
		case 'openai-compatible':
		case 'anthropic-compatible':
			return {};
		default:
			return assertNever(profile.provider);
	}
}

function normalizeProviderKind(value: unknown): ModelProviderKind {
	if (typeof value === 'string' && isModelProviderKind(value)) return value;
	throw new Error(`不支持的模型提供方：${String(value ?? '')}`);
}

function normalizeContextLimit(value: unknown): number {
	const limit = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(limit) || limit <= 0)
		return DEFAULT_PROFILE_CONTEXT_LIMIT;
	return Math.round(limit);
}

function cleanOptional(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function modelConfigDir(): string {
	return join(process.cwd(), '.mini-claude');
}

function modelConfigPath(): string {
	return join(modelConfigDir(), 'models.json');
}

function assertNever(value: never): never {
	throw new Error(`未处理的模型提供方：${String(value)}`);
}
