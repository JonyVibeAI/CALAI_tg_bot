import { prisma } from '../db/prisma';

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  SUBSCRIPTION_PRICE_STARS: '100',       // Цена подписки в звёздах
  SUBSCRIPTION_MONTHS: '1',              // Месяцев за 1 оплату
  FREE_ANALYSES_COUNT: '3',              // Бесплатных анализов для новых юзеров
  REQUIRED_CHANNELS: '',                 // Каналы для обязательной подписки (через запятую)
  CHANNEL_CHECK_ENABLED: 'false',        // Включена ли проверка подписки на каналы
};

// Получить настройку из БД или дефолт
export async function getSetting(key: string): Promise<string> {
  const setting = await prisma.settings.findUnique({ where: { key } });
  return setting?.value || DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS] || '';
}

// Установить настройку
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.settings.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

// Получить цену подписки в звёздах
export async function getSubscriptionPrice(): Promise<number> {
  const price = await getSetting('SUBSCRIPTION_PRICE_STARS');
  return parseInt(price) || 100;
}

// Получить количество бесплатных анализов для новых юзеров
export async function getFreeAnalysesCount(): Promise<number> {
  const count = await getSetting('FREE_ANALYSES_COUNT');
  return parseInt(count) || 3;
}

// Получить список обязательных каналов
export async function getRequiredChannels(): Promise<string[]> {
  const channels = await getSetting('REQUIRED_CHANNELS');
  if (!channels) return [];
  return channels.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

// Проверить, включена ли проверка каналов
export async function isChannelCheckEnabled(): Promise<boolean> {
  const enabled = await getSetting('CHANNEL_CHECK_ENABLED');
  return enabled === 'true';
}

// Проверить, есть ли у пользователя доступ к анализу
export async function checkUserAccess(userId: number): Promise<{
  hasAccess: boolean;
  reason: 'subscription' | 'free' | 'bonus' | 'none';
  remaining?: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionEnd: true,
      freeAnalysesLeft: true,
      bonusAnalyses: true,
    },
  });

  if (!user) {
    return { hasAccess: false, reason: 'none' };
  }

  // 1. Проверяем активную подписку
  if (user.subscriptionEnd && user.subscriptionEnd > new Date()) {
    return { hasAccess: true, reason: 'subscription' };
  }

  // 2. Проверяем бонусные анализы (от промокодов)
  if (user.bonusAnalyses > 0) {
    return { hasAccess: true, reason: 'bonus', remaining: user.bonusAnalyses };
  }

  // 3. Проверяем бесплатные анализы
  if (user.freeAnalysesLeft > 0) {
    return { hasAccess: true, reason: 'free', remaining: user.freeAnalysesLeft };
  }

  return { hasAccess: false, reason: 'none' };
}

// Использовать 1 анализ (вызывать после успешного анализа)
export async function useAnalysis(userId: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionEnd: true,
      freeAnalysesLeft: true,
      bonusAnalyses: true,
    },
  });

  if (!user) return;

  // Если есть подписка — ничего не списываем
  if (user.subscriptionEnd && user.subscriptionEnd > new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: { totalAnalysesUsed: { increment: 1 } },
    });
    return;
  }

  // Сначала списываем бонусные, потом бесплатные
  if (user.bonusAnalyses > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        bonusAnalyses: { decrement: 1 },
        totalAnalysesUsed: { increment: 1 },
      },
    });
  } else if (user.freeAnalysesLeft > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        freeAnalysesLeft: { decrement: 1 },
        totalAnalysesUsed: { increment: 1 },
      },
    });
  }
}

// Активировать подписку (после успешной оплаты)
export async function activateSubscription(
  userId: number,
  telegramPaymentId: string,
  stars: number,
  months: number = 1
): Promise<Date> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionEnd: true },
  });

  // Если подписка уже есть — продлеваем от текущей даты окончания
  const startDate = user?.subscriptionEnd && user.subscriptionEnd > new Date()
    ? user.subscriptionEnd
    : new Date();

  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + months);

  // Создаём запись о платеже
  await prisma.payment.create({
    data: {
      userId,
      telegramPaymentId,
      stars,
      months,
    },
  });

  // Обновляем дату подписки
  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionEnd: endDate },
  });

  return endDate;
}

// Получить инфо о подписке пользователя
export async function getUserSubscriptionInfo(userId: number): Promise<{
  hasSubscription: boolean;
  subscriptionEnd: Date | null;
  freeAnalysesLeft: number;
  bonusAnalyses: number;
  totalUsed: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionEnd: true,
      freeAnalysesLeft: true,
      bonusAnalyses: true,
      totalAnalysesUsed: true,
    },
  });

  if (!user) {
    return {
      hasSubscription: false,
      subscriptionEnd: null,
      freeAnalysesLeft: 3,
      bonusAnalyses: 0,
      totalUsed: 0,
    };
  }

  return {
    hasSubscription: user.subscriptionEnd ? user.subscriptionEnd > new Date() : false,
    subscriptionEnd: user.subscriptionEnd,
    freeAnalysesLeft: user.freeAnalysesLeft,
    bonusAnalyses: user.bonusAnalyses,
    totalUsed: user.totalAnalysesUsed,
  };
}
