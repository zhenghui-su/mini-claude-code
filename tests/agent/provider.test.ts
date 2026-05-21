import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	addModelProfile,
	deleteModelProfile,
	getDefaultModelId,
	getModelBaseURL,
	hasModelCredential,
	isStoredModelProfile,
	listModelProfiles,
	listStoredModelProfileIds,
	listUsableModelProfiles,
	normalizeModelProfile,
	resolveLanguageModel,
	setDefaultModelId,
} from '../../src/agent/provider';

let previousCwd: string;
let tempDir: string;
const modelEnvKeys = [
	'DEEPSEEK_API_KEY',
	'DEEPSEEK_API_BASE_URL',
	'OPENAI_API_KEY',
	'OPENAI_API_BASE_URL',
	'OPENAI_MODEL_ID',
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'ANTHROPIC_MODEL_ID',
] as const;
let previousEnv: Record<(typeof modelEnvKeys)[number], string | undefined>;

beforeEach(async () => {
	previousCwd = process.cwd();
	tempDir = await mkdtemp(join(tmpdir(), 'mini-agent-provider-'));
	process.chdir(tempDir);
	previousEnv = Object.fromEntries(
		modelEnvKeys.map((key) => [key, process.env[key]]),
	) as Record<(typeof modelEnvKeys)[number], string | undefined>;
	for (const key of modelEnvKeys) {
		delete process.env[key];
	}
});

afterEach(async () => {
	process.chdir(previousCwd);
	for (const key of modelEnvKeys) {
		if (previousEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = previousEnv[key];
		}
	}
	await rm(tempDir, { recursive: true, force: true });
});

test('normalizeModelProfile creates safe ids and defaults context limit', () => {
	const profile = normalizeModelProfile({
		id: ' My Model! ',
		provider: 'openai-compatible',
		modelId: 'gpt-compatible',
		baseURL: ' https://example.com/v1 ',
		apiKey: ' key ',
	});

	expect(profile).toMatchObject({
		id: 'My-Model',
		provider: 'openai-compatible',
		modelId: 'gpt-compatible',
		baseURL: 'https://example.com/v1',
		apiKey: 'key',
		contextLimit: 128_000,
	});
});

test('addModelProfile stores and lists custom model profiles', async () => {
	const saved = await addModelProfile({
		id: 'local-openai',
		provider: 'openai-compatible',
		modelId: 'local-model',
		baseURL: 'http://localhost:11434/v1',
		apiKey: 'test-key',
		contextLimit: 32_000,
	});

	const profiles = await listModelProfiles();

	expect(saved.id).toBe('local-openai');
	expect(profiles).toContainEqual(
		expect.objectContaining({
			id: 'local-openai',
			provider: 'openai-compatible',
			modelId: 'local-model',
			contextLimit: 32_000,
		}),
	);
});

test('DeepSeek is not injected as a built-in model', async () => {
	process.env.DEEPSEEK_API_KEY = 'test-key';

	expect(await listModelProfiles()).toEqual([]);

	await addModelProfile({
		id: 'deepseek-chat',
		provider: 'deepseek',
		modelId: 'deepseek-chat',
		apiKey: 'test-key',
	});

	expect((await listModelProfiles()).map((profile) => profile.id)).toEqual([
		'deepseek-chat',
	]);
	expect(await isStoredModelProfile('deepseek-chat')).toBe(true);
});

test('listUsableModelProfiles ignores built-in profiles without credentials', async () => {
	expect(await listUsableModelProfiles()).toEqual([]);

	await addModelProfile({
		id: 'custom',
		provider: 'openai-compatible',
		modelId: 'custom-chat',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});

	expect((await listUsableModelProfiles()).map((profile) => profile.id)).toEqual([
		'custom',
	]);
});

test('deleteModelProfile removes custom model profiles', async () => {
	await addModelProfile({
		id: 'remove-me',
		provider: 'openai-compatible',
		modelId: 'local-model',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});

	expect(await isStoredModelProfile('remove-me')).toBe(true);
	expect([...(await listStoredModelProfileIds())]).toContain('remove-me');
	expect(await deleteModelProfile('remove-me')).toBe(true);
	expect(await deleteModelProfile('remove-me')).toBe(false);
	expect(await isStoredModelProfile('remove-me')).toBe(false);
	expect((await listModelProfiles()).map((profile) => profile.id)).not.toContain(
		'remove-me',
	);
});

test('setDefaultModelId persists and deleteModelProfile clears matching default', async () => {
	await addModelProfile({
		id: 'first',
		provider: 'openai-compatible',
		modelId: 'first-model',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});
	await addModelProfile({
		id: 'second',
		provider: 'openai-compatible',
		modelId: 'second-model',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});

	expect(await setDefaultModelId('second')).toBe('second');
	expect(await getDefaultModelId()).toBe('second');

	await addModelProfile({
		id: 'third',
		provider: 'openai-compatible',
		modelId: 'third-model',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});
	expect(await getDefaultModelId()).toBe('second');

	await deleteModelProfile('second');
	expect(await getDefaultModelId()).toBeUndefined();
});

test('resolveLanguageModel builds an AI SDK model from a compatible profile', async () => {
	await addModelProfile({
		id: 'custom',
		provider: 'openai-compatible',
		modelId: 'custom-chat',
		baseURL: 'https://example.com/v1',
		apiKey: 'test-key',
	});

	const model = await resolveLanguageModel('custom');

	expect(model).toMatchObject({
		modelId: 'custom-chat',
	});
});

test('hasModelCredential and getModelBaseURL expose display-safe status', () => {
	const profile = normalizeModelProfile({
		id: 'custom',
		provider: 'anthropic-compatible',
		modelId: 'claude-custom',
		baseURL: 'https://example.com/anthropic',
		apiKey: 'secret',
	});

	expect(hasModelCredential(profile)).toBe(true);
	expect(getModelBaseURL(profile)).toBe('https://example.com/anthropic');
});
