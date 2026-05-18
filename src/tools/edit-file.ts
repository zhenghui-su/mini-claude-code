import { resolveSafePath } from '../utils/safety';
import { fail, ok, type ToolResult } from './result';

interface Params {
	path: string;
	old_string: string;
	new_string: string;
}

export async function editFile({
	path,
	old_string,
	new_string,
}: Params): Promise<ToolResult> {
	let safePath: string;
	try {
		safePath = resolveSafePath(path);
	} catch (e) {
		return fail(`错误：${(e as Error).message}`);
	}

	const file = Bun.file(safePath);
	if (!(await file.exists())) {
		return fail(`错误：文件 ${path} 不存在`);
	}

	const original = await file.text();

	// 唯一性校验: old_string必须只出现一次
	// 不唯一的替换会产生不确定性，可能导致错误的替换
	const occurrences = original.split(old_string).length - 1;
	if (occurrences === 0) {
		return fail([
			`错误: old_string 在 ${path} 中不存在。`,
			`请先用 read_file 读取文件，确认目标字符串（注意空格和换行）。`,
		].join('\n'));
	}
	if (occurrences > 1) {
		return fail([
			`错误: old_string 在 ${path} 中出现了 ${occurrences} 次，无法唯一定位。`,
			`请在 old_string 中加入更多上下文（前后几行）使其唯一。`,
		].join('\n'));
	}
	const updated = original.replace(old_string, new_string);
	await Bun.write(safePath, updated);

	return ok(`已替换 ${path} 中的目标字符串`, {
		path,
		oldChars: old_string.length,
		newChars: new_string.length,
	});
}
