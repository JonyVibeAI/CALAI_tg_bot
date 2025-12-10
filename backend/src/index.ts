import { connectDatabase, disconnectDatabase } from './db/prisma';
import { initializeBot } from './telegram/bot';

async function start() {
  try {
    await connectDatabase();
    initializeBot();

    const shutdown = async (signal: string) => {
      console.log(`\n✓ Остановка бота (${signal})...`);
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('✗ Ошибка запуска:', error);
    process.exit(1);
  }
}

start();





