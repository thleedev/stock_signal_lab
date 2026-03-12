import type { AiProvider } from './types';
import { GeminiProvider } from './gemini';

export type { AiProvider, GenerateOptions } from './types';
export { GeminiProvider } from './gemini';

export function createAiProvider(): AiProvider {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return new GeminiProvider(geminiKey);
  }

  throw new Error('AI 프로바이더를 설정할 수 없습니다. GEMINI_API_KEY 환경변수를 확인하세요.');
}
