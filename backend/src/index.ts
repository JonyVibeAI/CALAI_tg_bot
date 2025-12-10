import http from 'http';
import { connectDatabase, disconnectDatabase } from './db/prisma';
import { initializeBot } from './telegram/bot';

// Health check server для Docker
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function start() {
  try {
    await connectDatabase();
    initializeBot();

    // Запускаем health сервер на порту 4000
    const PORT = process.env.HEALTH_PORT || 4000;
    healthServer.listen(PORT, () => {
      console.log(`✓ Health server на порту ${PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n✓ Остановка бота (${signal})...`);
      healthServer.close();
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
