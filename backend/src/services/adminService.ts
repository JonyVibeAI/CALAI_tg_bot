import { prisma } from '../db/prisma';

// Получить общую статистику бота
export async function getBotStats(): Promise<{
  totalUsers: number;
  activeSubscriptions: number;
  totalPayments: number;
  totalStarsEarned: number;
  totalMeals: number;
  totalAnalyses: number;
  todayUsers: number;
  todayMeals: number;
}> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalUsers,
    activeSubscriptions,
    paymentsData,
    analysesData,
    todayUsers,
    totalMeals,
    todayMeals,
  ] = await Promise.all([
    // Всего пользователей
    prisma.user.count(),
    
    // Активных подписок
    prisma.user.count({
      where: { subscriptionEnd: { gt: now } },
    }),
    
    // Платежи
    prisma.payment.aggregate({
      _count: true,
      _sum: { stars: true },
    }),
    
    // Всего анализов
    prisma.user.aggregate({
      _sum: { totalAnalysesUsed: true },
    }),
    
    // Новых пользователей сегодня
    prisma.user.count({
      where: { createdAt: { gte: todayStart } },
    }),

    // Всего приёмов пищи
    prisma.meal.count(),
    
    // Приёмов пищи сегодня
    prisma.meal.count({
      where: { createdAt: { gte: todayStart } },
    }),
  ]);

  return {
    totalUsers,
    activeSubscriptions,
    totalPayments: paymentsData._count,
    totalStarsEarned: paymentsData._sum.stars || 0,
    totalMeals,
    totalAnalyses: analysesData._sum.totalAnalysesUsed || 0,
    todayUsers,
    todayMeals,
  };
}

// Проверить, является ли пользователь админом
export async function isAdmin(telegramId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { isAdmin: true },
  });
  return user?.isAdmin || false;
}

// Сделать пользователя админом
export async function setAdmin(telegramId: string, isAdmin: boolean): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { telegramId },
      data: { isAdmin },
    });
    return true;
  } catch {
    return false;
  }
}

// Получить топ пользователей по анализам
export async function getTopUsers(limit: number = 10): Promise<Array<{
  telegramId: string;
  username: string | null;
  firstName: string | null;
  totalAnalysesUsed: number;
  hasSubscription: boolean;
}>> {
  const now = new Date();
  
  const users = await prisma.user.findMany({
    take: limit,
    orderBy: { totalAnalysesUsed: 'desc' },
    select: {
      telegramId: true,
      username: true,
      firstName: true,
      totalAnalysesUsed: true,
      subscriptionEnd: true,
    },
  });

  return users.map(u => ({
    telegramId: u.telegramId,
    username: u.username,
    firstName: u.firstName,
    totalAnalysesUsed: u.totalAnalysesUsed,
    hasSubscription: u.subscriptionEnd ? u.subscriptionEnd > now : false,
  }));
}

// Получить последние платежи
export async function getRecentPayments(limit: number = 10): Promise<Array<{
  id: number;
  stars: number;
  months: number;
  createdAt: Date;
  user: {
    telegramId: string;
    username: string | null;
  };
}>> {
  return prisma.payment.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          telegramId: true,
          username: true,
        },
      },
    },
  });
}

// Получить все telegram ID пользователей для рассылки
export async function getAllUserTelegramIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    select: { telegramId: true },
  });
  return users.map(u => u.telegramId);
}
