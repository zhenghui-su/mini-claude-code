import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { resolveSafePath } from '../utils/safety';
import { fail, ok, type ToolResult } from './result';

interface Params {
	path: string;
	content: string;
}
/**
 * 写入内容到文件
 */
export async function writeFile({ path, content }: Params): Promise<ToolResult> {
	let safePath: string;
	try {
		safePath = resolveSafePath(path);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	// 确保父目录存在（Bun.write 不会自动创建目录）
	await mkdir(dirname(safePath), { recursive: true });

	await Bun.write(safePath, content);

	return ok(`已写入 ${path}（${content.length} 字符）`, {
		path,
		chars: content.length,
	});
}
