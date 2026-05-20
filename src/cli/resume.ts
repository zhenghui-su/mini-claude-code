import readline from 'readline';
import {
	deleteSession,
	listSessions,
	summarizeSession,
	type SavedSession,
} from '../agent/session';
import {
	displayWidth,
	extractMessageText,
	formatSessionTime,
	truncateByDisplayWidth,
	truncateDisplay,
} from './format';

let isResumeScreenActive = false;

export async function chooseSession(): Promise<SavedSession | undefined> {
	let sessions = await listSessions();
	if (sessions.length === 0) {
		console.log('\x1b[90m[当前目录暂无历史会话]\x1b[0m');
		return undefined;
	}

	let selectedIndex = 0;
	let deleteIndex: number | undefined;

	return new Promise((resolve) => {
		const finish = (session: SavedSession | undefined) => {
			process.stdin.off('keypress', onKeypress);
			exitResumeScreen();
			resolve(session);
		};

		const onKeypress = (_char: string | undefined, key: readline.Key) => {
			if (key?.ctrl && key.name === 'c') {
				finish(undefined);
				return;
			}
			if (deleteIndex !== undefined) {
				if (key?.name === 'escape' || key?.name === 'n' || key?.name === 'q') {
					deleteIndex = undefined;
					renderResumeList(sessions, selectedIndex, deleteIndex);
					return;
				}
				if (key?.name === 'y') {
					const session = sessions[deleteIndex];
					if (!session) return;

					void deleteSelectedSession(session.name)
						.then(async () => {
							sessions = await listSessions();
							deleteIndex = undefined;
							if (sessions.length === 0) {
								finish(undefined);
								return;
							}
							selectedIndex = Math.min(selectedIndex, sessions.length - 1);
							renderResumeList(sessions, selectedIndex, deleteIndex);
						})
						.catch((e) => {
							deleteIndex = undefined;
							renderResumeList(
								sessions,
								selectedIndex,
								deleteIndex,
								`删除失败：${(e as Error).message}`,
							);
						});
					return;
				}
				return;
			}

			if (key?.name === 'escape' || key?.name === 'q') {
				finish(undefined);
				return;
			}
			if (key?.name === 'return') {
				finish(sessions[selectedIndex]);
				return;
			}
			if (key?.name === 'd') {
				deleteIndex = selectedIndex;
				renderResumeList(sessions, selectedIndex, deleteIndex);
				return;
			}
			if (key?.name === 'up') {
				selectedIndex = (selectedIndex - 1 + sessions.length) % sessions.length;
				renderResumeList(sessions, selectedIndex, deleteIndex);
				return;
			}
			if (key?.name === 'down') {
				selectedIndex = (selectedIndex + 1) % sessions.length;
				renderResumeList(sessions, selectedIndex, deleteIndex);
			}
		};

		process.stdin.on('keypress', onKeypress);
		enterResumeScreen();
		renderResumeList(sessions, selectedIndex, deleteIndex);
	});
}

export function printSessionTranscript(session: SavedSession) {
	const meaningful = session.history.filter(
		(message) => message.role === 'user' || message.role === 'assistant',
	);
	if (meaningful.length === 0) return;

	console.log('\x1b[1m已恢复历史记录：\x1b[0m');
	for (const message of meaningful) {
		const text = extractMessageText(message.content);
		if (!text) continue;

		const label = message.role === 'user' ? '你' : 'Agent';
		console.log(`\x1b[90m${label}:\x1b[0m ${truncateDisplay(text, 600)}`);
	}
	console.log('');
}

async function deleteSelectedSession(name: string) {
	await deleteSession(name);
}

function renderResumeList(
	sessions: SavedSession[],
	selectedIndex: number,
	deleteIndex?: number,
	message?: string,
) {
	const maxWidth = Math.max(40, (process.stdout.columns ?? 80) - 1);
	const lines = [
		`\x1b[1m${truncateByDisplayWidth('选择要恢复的会话', maxWidth)}\x1b[0m`,
		`\x1b[90m${truncateByDisplayWidth('↑/↓ 选择，Enter 恢复，d 删除，q 取消', maxWidth)}\x1b[0m`,
		...sessions.map((session, index) => {
			const summary = summarizeSession(session);
			const marker = index === selectedIndex ? '›' : ' ';
			const prefix = `${marker} ${formatSessionTime(summary.updatedAt)}  `;
			const previewWidth = Math.max(8, maxWidth - displayWidth(prefix));
			const preview = truncateByDisplayWidth(
				summary.lastReplyPreview,
				Math.min(24, previewWidth),
			);
			const clipped = `${prefix}${preview}`;
			return index === selectedIndex ? `\x1b[7m${clipped}\x1b[0m` : clipped;
		}),
		...(deleteIndex !== undefined
			? [
					`\x1b[31m${truncateByDisplayWidth(`确认删除该会话？按 y 删除，n 取消`, maxWidth)}\x1b[0m`,
				]
			: []),
		...(message
			? [`\x1b[33m${truncateByDisplayWidth(message, maxWidth)}\x1b[0m`]
			: []),
	];

	if (process.stdout.isTTY) {
		process.stdout.write('\x1b[H\x1b[2J');
	}
	process.stdout.write(lines.join('\n'));
}

function enterResumeScreen() {
	if (!process.stdout.isTTY || isResumeScreenActive) return;

	process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
	isResumeScreenActive = true;
}

function exitResumeScreen() {
	if (!process.stdout.isTTY || !isResumeScreenActive) return;

	process.stdout.write('\x1b[?25h\x1b[?1049l');
	isResumeScreenActive = false;
}
