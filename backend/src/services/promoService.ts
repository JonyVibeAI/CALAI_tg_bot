import { prisma } from '../db/prisma';

// Генерировать случайный код
function generateCode(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Создать новый промокод
export async function createPromo(options: {
  code?: string;           // Если не указан — генерируется автоматически
  analysesCount: number;   // Сколько анализов даёт
  maxUses?: number;        // Макс. использований (null = безлимит)
  expiresAt?: Date;        // Срок действия
}): Promise<{
  code: string;
  analysesCount: number;
  maxUses: number | null;
  expiresAt: Date | null;
}> {
  const code = options.code || generateCode();

  const promo = await prisma.promo.create({
    data: {
      code: code.toUpperCase(),
      analysesCount: options.analysesCount,
      maxUses: options.maxUses || null,
      expiresAt: options.expiresAt || null,
    },
  });

  return {
    code: promo.code,
    analysesCount: promo.analysesCount,
    maxUses: promo.maxUses,
    expiresAt: promo.expiresAt,
  };
}

// Активировать промокод для пользователя
export async function activatePromo(userId: number, code: string): Promise<{
  success: boolean;
  message: string;
  analysesAdded?: number;
}> {
  const promo = await prisma.promo.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      activations: {
        where: { userId },
      },
    },
  });

  // Проверки
  if (!promo) {
    return { success: false, message: 'Промокод не найден' };
  }

  if (!promo.isActive) {
    return { success: false, message: 'Промокод неактивен' };
  }

  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { success: false, message: 'Срок действия промокода истёк' };
  }

  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return { success: false, message: 'Промокод уже использован максимальное число раз' };
  }

  if (promo.activations.length > 0) {
    return { success: false, message: 'Ты уже активировал этот промокод' };
  }

  // Активируем
  await prisma.$transaction([
    // Создаём запись об активации
    prisma.promoActivation.create({
      data: { promoId: promo.id, userId },
    }),
    // Увеличиваем счётчик использований
    prisma.promo.update({
      where: { id: promo.id },
      data: { usedCount: { increment: 1 } },
    }),
    // Начисляем бонусные анализы пользователю
    prisma.user.update({
      where: { id: userId },
      data: { bonusAnalyses: { increment: promo.analysesCount } },
    }),
  ]);

  return {
    success: true,
    message: `Промокод активирован! Добавлено ${promo.analysesCount} анализов`,
    analysesAdded: promo.analysesCount,
  };
}

// Получить список всех промокодов (для админки)
export async function getAllPromos(): Promise<Array<{
  id: number;
  code: string;
  analysesCount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}>> {
  return prisma.promo.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

// Деактивировать промокод
export async function deactivatePromo(code: string): Promise<boolean> {
  const result = await prisma.promo.updateMany({
    where: { code: code.toUpperCase() },
    data: { isActive: false },
  });
  return result.count > 0;
}

// Удалить промокод
export async function deletePromo(code: string): Promise<boolean> {
  try {
    await prisma.promo.delete({
      where: { code: code.toUpperCase() },
    });
    return true;
  } catch {
    return false;
  }
}
