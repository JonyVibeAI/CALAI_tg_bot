import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = ['DATABASE_URL', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`✗ Отсутствует переменная окружения: ${envVar}`);
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
  openaiModelText: process.env.OPENAI_MODEL_TEXT || 'gpt-4o-mini',
  openaiModelVision: process.env.OPENAI_MODEL_VISION || 'gpt-4o',
  // Прокси для OpenAI (нужен для работы из России)
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
};
