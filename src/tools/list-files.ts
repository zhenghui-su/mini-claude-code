import { readdir } from 'fs/promises';
import { join, relative } from 'path';
import { resolveSafePath } from '../utils/safety';
import { fail, ok, type ToolResult } from './result';

interface Params {
	path?: string;
	depth?: number;
	includeHidden?: boolean;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.mini-claude']);

export async function listFiles({
	path = '.',
	depth = 2,
	includeHidden = false,
}: Params): Promise<ToolResult> {
	let root: string;
	try {
		root = resolveSafePath(path);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	const entries: string[] = [];

	async function walk(dir: string, currentDepth: number) {
		if (currentDepth > depth) return;

		let children;
		try {
			children = await readdir(dir, { withFileTypes: true });
		} catch (e) {
			throw new Error(`无法读取目录 ${relative(process.cwd(), dir) || '.'}: ${(e as Error).message}`);
		}

		for (const child of children) {
			if (!includeHidden && child.name.startsWith('.')) continue;
			if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue;

			const absolute = join(dir, child.name);
			const projectPath = relative(process.cwd(), absolute) || '.';
			entries.push(child.isDirectory() ? `${projectPath}/` : projectPath);

			if (child.isDirectory()) {
				await walk(absolute, currentDepth + 1);
			}
		}
	}

	try {
		await walk(root, 0);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	entries.sort();

	return ok(`已列出 ${path} 下 ${entries.length} 个条目`, {
		path,
		depth,
		entries,
	});
}
