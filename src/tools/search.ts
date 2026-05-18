import { readdir } from 'fs/promises';
import { join, relative } from 'path';
import { resolveSafePath } from '../utils/safety';
import { truncateOutput } from '../utils/truncate';
import { fail, ok, type ToolResult } from './result';

interface Params {
	query: string;
	path?: string;
	glob?: string;
	maxResults?: number;
}

interface SearchMatch {
	path: string;
	line: number;
	text: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.mini-claude']);
const MAX_FILE_BYTES = 1_000_000;

export async function search({
	query,
	path = '.',
	glob,
	maxResults = 50,
}: Params): Promise<ToolResult> {
	let root: string;
	try {
		root = resolveSafePath(path);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	const matches: SearchMatch[] = [];
	const needle = query.toLowerCase();
	const fileMatcher = glob ? createGlobMatcher(glob) : undefined;

	async function walk(dir: string) {
		if (matches.length >= maxResults) return;

		const children = await readdir(dir, { withFileTypes: true });
		for (const child of children) {
			if (matches.length >= maxResults) return;
			if (child.name.startsWith('.')) continue;
			if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue;

			const absolute = join(dir, child.name);
			const projectPath = relative(process.cwd(), absolute);

			if (child.isDirectory()) {
				await walk(absolute);
				continue;
			}

			if (fileMatcher && !fileMatcher(projectPath)) continue;
			await searchFile(absolute, projectPath);
		}
	}

	async function searchFile(absolute: string, projectPath: string) {
		const file = Bun.file(absolute);
		if (file.size > MAX_FILE_BYTES) return;

		let text: string;
		try {
			text = await file.text();
		} catch {
			return;
		}

		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (matches.length >= maxResults) return;
			const line = lines[i] ?? '';
			if (!line.toLowerCase().includes(needle)) continue;

			matches.push({
				path: projectPath,
				line: i + 1,
				text: line.trim(),
			});
		}
	}

	try {
		await walk(root);
	} catch (e) {
		return fail(`错误：搜索失败 - ${(e as Error).message}`);
	}

	const preview = matches
		.map((match) => `${match.path}:${match.line}: ${match.text}`)
		.join('\n');

	return ok(`搜索完成：${matches.length} 个匹配`, {
		query,
		path,
		glob,
		truncated: matches.length >= maxResults,
		matches,
		preview: truncateOutput('search', preview || '(无匹配)'),
	});
}

function createGlobMatcher(glob: string): (path: string) => boolean {
	const pattern = new RegExp(`^${globToRegex(glob)}$`);
	return (path) => pattern.test(path);
}

function globToRegex(glob: string): string {
	let regex = '';

	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		const next = glob[i + 1];
		const afterNext = glob[i + 2];

		if (char === '*' && next === '*' && afterNext === '/') {
			regex += '(?:.*/)?';
			i += 2;
			continue;
		}

		if (char === '*' && next === '*') {
			regex += '.*';
			i++;
			continue;
		}

		if (char === '*') {
			regex += '[^/]*';
			continue;
		}

		regex += escapeRegex(char ?? '');
	}

	return regex;
}

function escapeRegex(value: string): string {
	return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
