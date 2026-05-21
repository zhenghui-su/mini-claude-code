import { createDeepSeek } from '@ai-sdk/deepseek';

const deepseek = createDeepSeek({
	apiKey: process.env.DEEPSEEK_API_KEY!,
	baseURL: process.env.DEEPSEEK_API_BASE_URL! || 'https://api.deepseek.com',
});

export const MODEL_ID = 'deepseek-chat';

export const model = deepseek(MODEL_ID);
