import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'connection_limit=5&pool_timeout=10',
    },
  },
});

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✓ База данных подключена');
  } catch (error) {
    console.error('✗ Ошибка подключения к БД:', error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}





