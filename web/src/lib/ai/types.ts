export interface AiProvider {
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}
