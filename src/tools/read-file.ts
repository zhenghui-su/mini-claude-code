import { resolveSafePath, isSensitivePath } from '../utils/safety';
import { truncateOutput } from '../utils/truncate';
import { fail, ok, type ToolResult } from './result';

interface Params {
	path: string;
	offset?: number;
	limit?: number;
}
/**
 * 读取文件内容
 */
export async function readFile({
	path,
	offset,
	limit,
}: Params): Promise<ToolResult> {
	// 安全检查：路径穿越和敏感文件
	let safePath: string;
	try {
		safePath = resolveSafePath(path);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	// 敏感文件提示（不阻止，但提醒）
	if (isSensitivePath(path)) {
		console.warn(`\x1b[33m[警告] 正在读取敏感文件：${path}\x1b[0m`);
	}
	const file = Bun.file(safePath);
	if (!(await file.exists())) {
		return fail(`错误：文件不存在 - ${path}`);
	}
	const text = await file.text();
	const lines = text.split('\n');

	// 按offset/limit切片
	const start = offset ?? 0;
	const end = limit !== undefined ? start + limit : lines.length;
	const slice = lines.slice(start, end);

	// 带行号输出(方便LLM定位,减少edit_file时old_string的匹配错误)
	const withLineNumbers = slice
		.map((line, i) => `${start + i + 1}\t${line}`)
		.join('\n');

	// 附加元信息
	const meta =
		offset !== undefined || limit !== undefined
			? `\n[显示第 ${start + 1}-${Math.min(end, lines.length)} 行，共 ${lines.length} 行]`
			: `\n[共 ${lines.length} 行]`;

	const content = truncateOutput('read_file', withLineNumbers + meta);

	return ok(`已读取 ${path} 第 ${start + 1}-${Math.min(end, lines.length)} 行`, {
		path,
		content,
		startLine: start + 1,
		endLine: Math.min(end, lines.length),
		totalLines: lines.length,
	});
}
