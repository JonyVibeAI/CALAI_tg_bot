import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import { config } from '../config/env';
import { findOrCreateUser, getUserByTelegramId, updateUserCalories } from '../services/userService';
import { createMealFromText, createMealFromImage, determineMealType, getTodayMeals, getMealsByDate, deleteMeal } from '../services/mealService';
import { checkUserAccess, useAnalysis, getUserSubscriptionInfo, getSubscriptionPrice, activateSubscription, setSetting, getSetting } from '../services/subscriptionService';
import { activatePromo, createPromo, getAllPromos, deactivatePromo } from '../services/promoService';
import { getBotStats, isAdmin, setAdmin, getTopUsers, getRecentPayments } from '../services/adminService';

const bot = new TelegramBot(config.telegramBotToken, { polling: true });

const MEAL_TYPE_EMOJI: Record<string, string> = {
  BREAKFAST: '🍳',
  LUNCH: '🍽',
  DINNER: '🍴',
  SNACK: '🍎'
};

const MEAL_TYPE_RU: Record<string, string> = {
  BREAKFAST: 'Завтрак',
  LUNCH: 'Обед', 
  DINNER: 'Ужин',
  SNACK: 'Перекус'
};

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Сегодня', callback_data: 'today' },
        { text: '📝 История', callback_data: 'history' }
      ],
      [
        { text: '👤 Профиль', callback_data: 'profile' },
        { text: '🎯 Цель', callback_data: 'goal' }
      ],
      [
        { text: '⭐ Подписка', callback_data: 'subscription' },
        { text: '📈 Статистика', callback_data: 'stats' }
      ]
    ]
  };
}

// Функция для скачивания файла как base64
async function downloadImageAsBase64(fileUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(fileUrl, (response) => {
      const chunks: Buffer[] = [];
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        resolve(`data:image/jpeg;base64,${base64}`);
      });
      
      response.on('error', (error) => {
        reject(error);
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Проверка доступа + сообщение если нет
async function checkAndNotifyAccess(chatId: number, userId: number): Promise<boolean> {
  const access = await checkUserAccess(userId);
  
  if (!access.hasAccess) {
    const price = await getSubscriptionPrice();
    await bot.sendMessage(
      chatId,
      `⚠️ <b>Нет доступа к анализу</b>\n\n` +
      `Твои бесплатные анализы закончились.\n\n` +
      `Варианты:\n` +
      `⭐ Купить подписку — <b>${price} звёзд/мес</b> (безлимит)\n` +
      `🎁 Активировать промокод\n\n` +
      `Нажми кнопку ниже 👇`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `⭐ Купить подписку (${price} звёзд)`, callback_data: 'buy_subscription' }],
            [{ text: '🎁 Ввести промокод', callback_data: 'enter_promo' }],
            [{ text: '🏠 Меню', callback_data: 'menu' }]
          ]
        }
      }
    );
    return false;
  }
  
  return true;
}

export function initializeBot() {
  console.log('✓ Бот запущен');

  // ==================== КОМАНДЫ ====================

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    if (!user) return;

    try {
      const dbUser = await findOrCreateUser({
        telegramId: user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      });

      // Если это первый указанный админ — делаем его админом
      if (config.adminTelegramId && user.id.toString() === config.adminTelegramId) {
        await setAdmin(user.id.toString(), true);
      }

      const subInfo = await getUserSubscriptionInfo(dbUser.id);
      let accessInfo = '';
      
      if (subInfo.hasSubscription) {
        accessInfo = `✅ Подписка активна до ${subInfo.subscriptionEnd?.toLocaleDateString('ru-RU')}`;
      } else {
        const total = subInfo.freeAnalysesLeft + subInfo.bonusAnalyses;
        accessInfo = `📊 Доступно анализов: ${total}`;
      }

      await bot.sendMessage(
        chatId,
        `👋 Привет, ${user.first_name}!\n\n` +
        `🔥 <b>AI-трекер калорий</b>\n\n` +
        `Просто отправь:\n` +
        `📸 Фото еды — AI распознает и посчитает\n` +
        `📝 Текст — например: "2 яйца, овсянка 100г"\n\n` +
        `${accessInfo}\n\n` +
        `👇 Используй меню`,
        {
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard()
        }
      );
    } catch (error) {
      console.error('✗ Ошибка /start:', error);
      await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуй позже.');
    }
  });

  bot.onText(/\/menu/, async (msg) => {
    await bot.sendMessage(msg.chat.id, '📱 Главное меню:', { reply_markup: getMainMenuKeyboard() });
  });

  // Команда для активации промокода
  bot.onText(/\/promo(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;

    const dbUser = await getUserByTelegramId(user.id.toString());
    if (!dbUser) {
      await bot.sendMessage(chatId, 'Сначала нажми /start');
      return;
    }

    const code = match?.[1]?.trim();
    if (!code) {
      await bot.sendMessage(chatId, '🎁 Введи промокод:\n\nФормат: /promo КОД');
      return;
    }

    const result = await activatePromo(dbUser.id, code);
    await bot.sendMessage(
      chatId,
      result.success 
        ? `✅ ${result.message}` 
        : `❌ ${result.message}`,
      { reply_markup: getMainMenuKeyboard() }
    );
  });

  // ==================== АДМИН КОМАНДЫ ====================

  bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;

    const isUserAdmin = await isAdmin(user.id.toString());
    if (!isUserAdmin && user.id.toString() !== config.adminTelegramId) {
      await bot.sendMessage(chatId, '⛔ Нет доступа');
      return;
    }

    await bot.sendMessage(
      chatId,
      '🔧 <b>Админ-панель</b>\n\n' +
      'Выбери действие:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
            [{ text: '🎁 Промокоды', callback_data: 'admin_promos' }],
            [{ text: '⚙️ Настройки', callback_data: 'admin_settings' }],
            [{ text: '👥 Топ юзеров', callback_data: 'admin_top_users' }],
            [{ text: '💰 Последние платежи', callback_data: 'admin_payments' }]
          ]
        }
      }
    );
  });

  // Создать промокод: /newpromo КОД АНАЛИЗЫ [МАКС_ИСПОЛЬЗОВАНИЙ]
  bot.onText(/\/newpromo\s+(\S+)\s+(\d+)(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;

    const isUserAdmin = await isAdmin(user.id.toString());
    if (!isUserAdmin && user.id.toString() !== config.adminTelegramId) {
      await bot.sendMessage(chatId, '⛔ Нет доступа');
      return;
    }

    const code = match?.[1];
    const analyses = parseInt(match?.[2] || '0');
    const maxUses = match?.[3] ? parseInt(match[3]) : undefined;

    if (!code || analyses <= 0) {
      await bot.sendMessage(chatId, '❌ Формат: /newpromo КОД АНАЛИЗЫ [МАКС_ИСПОЛЬЗОВАНИЙ]');
      return;
    }

    try {
      const promo = await createPromo({ code, analysesCount: analyses, maxUses });
      await bot.sendMessage(
        chatId,
        `✅ <b>Промокод создан!</b>\n\n` +
        `📝 Код: <code>${promo.code}</code>\n` +
        `📊 Анализов: ${promo.analysesCount}\n` +
        `👥 Макс. использований: ${promo.maxUses || '∞'}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Ошибка создания промокода (возможно, такой код уже есть)');
    }
  });

  // Установить цену подписки
  bot.onText(/\/setprice\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;

    const isUserAdmin = await isAdmin(user.id.toString());
    if (!isUserAdmin && user.id.toString() !== config.adminTelegramId) {
      await bot.sendMessage(chatId, '⛔ Нет доступа');
      return;
    }

    const price = parseInt(match?.[1] || '0');
    if (price < 1) {
      await bot.sendMessage(chatId, '❌ Цена должна быть > 0');
      return;
    }

    await setSetting('SUBSCRIPTION_PRICE_STARS', price.toString());
    await bot.sendMessage(chatId, `✅ Цена подписки установлена: ${price} ⭐`);
  });

  // ==================== CALLBACK QUERIES ====================

  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const user = query.from;
    
    if (!chatId || !user) return;

    try {
      const dbUser = await getUserByTelegramId(user.id.toString());
      if (!dbUser) {
        await bot.sendMessage(chatId, 'Сначала нажми /start');
        return;
      }

      const data = query.data;

      // Основные кнопки
      if (data === 'today') {
        await handleTodayStats(chatId, dbUser.id);
      } else if (data === 'history') {
        await handleHistory(chatId, dbUser.id);
      } else if (data?.startsWith('history_day_')) {
        const dateStr = data.replace('history_day_', '');
        await handleHistoryDay(chatId, dbUser.id, dateStr);
      } else if (data?.startsWith('delete_meal_')) {
        const mealId = parseInt(data.replace('delete_meal_', ''));
        await deleteMeal(mealId);
        await bot.sendMessage(chatId, '✅ Прием пищи удален');
        await handleTodayStats(chatId, dbUser.id);
      } else if (data === 'profile') {
        await handleProfile(chatId, dbUser);
      } else if (data === 'goal') {
        await handleGoal(chatId, dbUser);
      } else if (data === 'stats') {
        await handleStats(chatId, dbUser.id);
      } else if (data === 'menu') {
        await bot.sendMessage(chatId, '📱 Главное меню:', { reply_markup: getMainMenuKeyboard() });
      }
      
      // Подписка
      else if (data === 'subscription') {
        await handleSubscription(chatId, dbUser.id);
      } else if (data === 'buy_subscription') {
        await handleBuySubscription(chatId, dbUser.id);
      } else if (data === 'enter_promo') {
        await bot.sendMessage(chatId, '🎁 Отправь промокод командой:\n\n/promo ТВОЙКОД');
      }

      // Админ-панель
      else if (data === 'admin_stats') {
        await handleAdminStats(chatId, user.id.toString());
      } else if (data === 'admin_promos') {
        await handleAdminPromos(chatId, user.id.toString());
      } else if (data === 'admin_settings') {
        await handleAdminSettings(chatId, user.id.toString());
      } else if (data === 'admin_top_users') {
        await handleAdminTopUsers(chatId, user.id.toString());
      } else if (data === 'admin_payments') {
        await handleAdminPayments(chatId, user.id.toString());
      } else if (data?.startsWith('deactivate_promo_')) {
        const code = data.replace('deactivate_promo_', '');
        await deactivatePromo(code);
        await bot.sendMessage(chatId, `✅ Промокод ${code} деактивирован`);
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('✗ Ошибка callback:', error);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка' });
    }
  });

  // ==================== ОПЛАТА TELEGRAM STARS ====================

  bot.on('pre_checkout_query', async (query) => {
    // Подтверждаем платёж
    await bot.answerPreCheckoutQuery(query.id, true);
  });

  bot.on('message', async (msg) => {
    // Обработка успешного платежа
    if (msg.successful_payment) {
      const chatId = msg.chat.id;
      const user = msg.from;
      if (!user) return;

      const dbUser = await getUserByTelegramId(user.id.toString());
      if (!dbUser) return;

      const payment = msg.successful_payment;
      const stars = payment.total_amount; // В Telegram Stars amount = количество звёзд
      
      try {
        const endDate = await activateSubscription(
          dbUser.id,
          payment.telegram_payment_charge_id,
          stars,
          1 // 1 месяц
        );

        await bot.sendMessage(
          chatId,
          `🎉 <b>Подписка активирована!</b>\n\n` +
          `⭐ Оплачено: ${stars} звёзд\n` +
          `📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}\n\n` +
          `Теперь у тебя безлимитный доступ к анализу еды! 🔥`,
          { 
            parse_mode: 'HTML',
            reply_markup: getMainMenuKeyboard()
          }
        );
      } catch (error) {
        console.error('✗ Ошибка активации подписки:', error);
      }
      return;
    }

    // Пропускаем команды и фото
    if (msg.text?.startsWith('/') || msg.photo) return;
    
    const chatId = msg.chat.id;
    const user = msg.from;
    const text = msg.text;

    if (!user || !text) return;

    try {
      const telegramId = user.id.toString();
      const dbUser = await getUserByTelegramId(telegramId);

      if (!dbUser) {
        await bot.sendMessage(chatId, 'Сначала нажми /start');
        return;
      }

      // Проверяем, это число (установка цели)
      if (/^\d+$/.test(text.trim())) {
        const dailyCalories = parseInt(text.trim());
        if (dailyCalories >= 1000 && dailyCalories <= 5000) {
          await updateUserCalories(dbUser.id, dailyCalories);
          await bot.sendMessage(
            chatId,
            `✅ Цель установлена: <b>${dailyCalories}</b> ккал/день`,
            { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
          );
          return;
        }
      }

      // Проверяем доступ
      if (!await checkAndNotifyAccess(chatId, dbUser.id)) return;

      await bot.sendMessage(chatId, '🔄 Анализирую еду...');
      
      const now = new Date();
      const mealType = determineMealType(now.getHours());
      const meal = await createMealFromText(dbUser.id, now, text, mealType);

      // Списываем анализ
      await useAnalysis(dbUser.id);

      const itemsList = meal.items
        .map((item) => `• ${item.name} (${item.grams}г) - ${item.calories} ккал`)
        .join('\n');

      await bot.sendMessage(
        chatId,
        `✅ Добавлено!\n\n` +
        `${MEAL_TYPE_EMOJI[meal.type]} <b>${MEAL_TYPE_RU[meal.type]}</b>\n\n` +
        `📋 Продукты:\n${itemsList}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📊 <b>Итого:</b>\n` +
        `🔥 Калории: <b>${meal.totalCalories}</b> ккал\n` +
        `💪 Белки: ${meal.totalProtein.toFixed(1)}г\n` +
        `🥑 Жиры: ${meal.totalFat.toFixed(1)}г\n` +
        `🍞 Углеводы: ${meal.totalCarbs.toFixed(1)}г`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
      );
    } catch (error: any) {
      console.error('✗ Ошибка текста:', error);
      await bot.sendMessage(
        chatId,
        `❌ Не удалось распознать еду\n${error.message || 'Попробуй еще раз'}`,
        { reply_markup: getMainMenuKeyboard() }
      );
    }
  });

  // ==================== ФОТО ====================

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    if (!user || !msg.photo) return;

    try {
      const telegramId = user.id.toString();
      const dbUser = await getUserByTelegramId(telegramId);

      if (!dbUser) {
        await bot.sendMessage(chatId, 'Сначала нажми /start');
        return;
      }

      // Проверяем доступ
      if (!await checkAndNotifyAccess(chatId, dbUser.id)) return;

      await bot.sendMessage(chatId, '🔄 Анализирую фото еды...');

      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);

      if (!file.file_path) {
        throw new Error('Не удалось получить файл');
      }

      const imageUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      console.log('📸 Скачиваю фото...');
      const imageBase64 = await downloadImageAsBase64(imageUrl);
      console.log('✓ Фото скачано, отправляю в OpenAI...');
      
      const now = new Date();
      const meal = await createMealFromImage(dbUser.id, now, imageBase64);

      // Списываем анализ
      await useAnalysis(dbUser.id);

      const itemsList = meal.items
        .map((item) => `• ${item.name} (${item.grams}г) - ${item.calories} ккал`)
        .join('\n');

      await bot.sendMessage(
        chatId,
        `✅ Фото проанализировано!\n\n` +
        `${MEAL_TYPE_EMOJI[meal.type]} <b>${MEAL_TYPE_RU[meal.type]}</b>\n\n` +
        `📋 Обнаруженные продукты:\n${itemsList}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📊 <b>Итого:</b>\n` +
        `🔥 Калории: <b>${meal.totalCalories}</b> ккал\n` +
        `💪 Белки: ${meal.totalProtein.toFixed(1)}г\n` +
        `🥑 Жиры: ${meal.totalFat.toFixed(1)}г\n` +
        `🍞 Углеводы: ${meal.totalCarbs.toFixed(1)}г`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
      );
    } catch (error: any) {
      console.error('✗ Ошибка фото:', error);
      await bot.sendMessage(
        chatId,
        `❌ Не удалось проанализировать фото\n${error.message || 'Попробуй еще раз'}`,
        { reply_markup: getMainMenuKeyboard() }
      );
    }
  });

  bot.on('polling_error', (error) => {
    console.error('✗ Ошибка polling:', error);
  });
}

// ==================== HANDLERS ====================

async function handleTodayStats(chatId: number, userId: number) {
  const stats = await getTodayMeals(userId);
  
  if (stats.meals.length === 0) {
    await bot.sendMessage(
      chatId,
      '📊 <b>Сегодня</b>\n\nЕще нет записей.\n\n📸 Отправь фото или текст с едой!',
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  const mealsList = stats.meals.map((meal) => {
    const time = new Date(meal.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const items = meal.items.map(i => i.name).join(', ');
    return `${MEAL_TYPE_EMOJI[meal.type]} <b>${time}</b> — ${items}\n   ${meal.totalCalories} ккал`;
  }).join('\n\n');

  let progress = '';
  if (stats.dailyCalories) {
    const percent = Math.round(stats.totalCalories / stats.dailyCalories * 100);
    const bars = '█'.repeat(Math.min(Math.floor(percent / 10), 10));
    progress = `\n\n📈 <b>Прогресс:</b> ${stats.totalCalories}/${stats.dailyCalories} ккал\n${bars} ${percent}%`;
  }

  await bot.sendMessage(
    chatId,
    `📊 <b>Сегодня</b>\n\n${mealsList}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🔥 Калории: <b>${stats.totalCalories}</b> ккал\n` +
    `💪 Белки: ${stats.totalProtein.toFixed(1)}г\n` +
    `🥑 Жиры: ${stats.totalFat.toFixed(1)}г\n` +
    `🍞 Углеводы: ${stats.totalCarbs.toFixed(1)}г${progress}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleHistory(chatId: number, userId: number) {
  const last7Days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    last7Days.push(date);
  }

  const historyData = await Promise.all(
    last7Days.map(async (date) => {
      const stats = await getMealsByDate(userId, date);
      return { date, ...stats };
    })
  );

  const historyList = historyData.map((day) => {
    const dateStr = day.date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const weekday = day.date.toLocaleDateString('ru-RU', { weekday: 'short' });
    
    if (day.meals.length === 0) {
      return `📅 <b>${dateStr}</b> (${weekday})\n   —`;
    }
    
    return `📅 <b>${dateStr}</b> (${weekday})\n   ${day.totalCalories} ккал • ${day.meals.length} приемов`;
  }).join('\n\n');

  await bot.sendMessage(
    chatId,
    `📝 <b>История за неделю</b>\n\n${historyList}`,
    { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...last7Days.slice(0, 3).map(date => [{
            text: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', weekday: 'short' }),
            callback_data: `history_day_${date.toISOString().split('T')[0]}`
          }]),
          [{ text: '🏠 Главное меню', callback_data: 'menu' }]
        ]
      }
    }
  );
}

async function handleHistoryDay(chatId: number, userId: number, dateStr: string) {
  const date = new Date(dateStr);
  const stats = await getMealsByDate(userId, date);
  
  if (stats.meals.length === 0) {
    await bot.sendMessage(
      chatId,
      `📅 <b>${date.toLocaleDateString('ru-RU')}</b>\n\nНет записей`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  const mealsList = stats.meals.map((meal) => {
    const time = new Date(meal.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const items = meal.items.map(i => `${i.name} (${i.grams}г)`).join(', ');
    return `${MEAL_TYPE_EMOJI[meal.type]} <b>${time}</b> — ${MEAL_TYPE_RU[meal.type]}\n   ${items}\n   ${meal.totalCalories} ккал`;
  }).join('\n\n');

  await bot.sendMessage(
    chatId,
    `📅 <b>${date.toLocaleDateString('ru-RU')}</b>\n\n${mealsList}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🔥 Калории: <b>${stats.totalCalories}</b> ккал`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleProfile(chatId: number, user: any) {
  const subInfo = await getUserSubscriptionInfo(user.id);
  
  const info = [];
  if (user.firstName) info.push(`👤 Имя: ${user.firstName}`);
  if (user.username) info.push(`📱 Username: @${user.username}`);
  if (user.dailyCalories) info.push(`🎯 Цель: ${user.dailyCalories} ккал/день`);
  
  info.push('');
  if (subInfo.hasSubscription) {
    info.push(`⭐ Подписка до: ${subInfo.subscriptionEnd?.toLocaleDateString('ru-RU')}`);
  } else {
    info.push(`📊 Бесплатных анализов: ${subInfo.freeAnalysesLeft}`);
    if (subInfo.bonusAnalyses > 0) {
      info.push(`🎁 Бонусных анализов: ${subInfo.bonusAnalyses}`);
    }
  }
  info.push(`📈 Всего анализов: ${subInfo.totalUsed}`);

  await bot.sendMessage(
    chatId,
    `👤 <b>Профиль</b>\n\n${info.join('\n')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleGoal(chatId: number, user: any) {
  await bot.sendMessage(
    chatId,
    `🎯 <b>Дневная цель</b>\n\n` +
    (user.dailyCalories 
      ? `Текущая: <b>${user.dailyCalories}</b> ккал/день\n\n` 
      : 'Не установлена\n\n') +
    `Отправь число (1000-5000) чтобы установить цель`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleStats(chatId: number, userId: number) {
  const last7Days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    last7Days.push(date);
  }

  const weekData = await Promise.all(
    last7Days.map(async (date) => {
      const stats = await getMealsByDate(userId, date);
      return { date, calories: stats.totalCalories };
    })
  );

  const totalWeekCalories = weekData.reduce((sum, day) => sum + day.calories, 0);
  const avgCalories = Math.round(totalWeekCalories / 7);

  const chart = weekData.reverse().map((day) => {
    const height = Math.min(Math.floor(day.calories / 200), 10);
    const bar = '█'.repeat(height || 0);
    const weekday = day.date.toLocaleDateString('ru-RU', { weekday: 'short' });
    return `${weekday} ${bar} ${day.calories}`;
  }).join('\n');

  await bot.sendMessage(
    chatId,
    `📈 <b>Статистика за неделю</b>\n\n` +
    `${chart}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📊 Всего: ${totalWeekCalories} ккал\n` +
    `📉 Среднее: ${avgCalories} ккал/день`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleSubscription(chatId: number, userId: number) {
  const subInfo = await getUserSubscriptionInfo(userId);
  const price = await getSubscriptionPrice();

  let statusText = '';
  if (subInfo.hasSubscription) {
    statusText = `✅ <b>Подписка активна</b>\n📅 До: ${subInfo.subscriptionEnd?.toLocaleDateString('ru-RU')}\n\n🔥 Безлимитный доступ к анализу еды!`;
  } else {
    const total = subInfo.freeAnalysesLeft + subInfo.bonusAnalyses;
    statusText = `📊 <b>Без подписки</b>\n\nДоступно анализов: ${total}\n• Бесплатных: ${subInfo.freeAnalysesLeft}\n• Бонусных: ${subInfo.bonusAnalyses}`;
  }

  await bot.sendMessage(
    chatId,
    `⭐ <b>Подписка</b>\n\n${statusText}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💎 <b>Premium подписка</b>\n` +
    `• Безлимитный анализ еды\n` +
    `• Приоритетная обработка\n` +
    `• Цена: <b>${price} ⭐/мес</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `⭐ Купить подписку (${price} звёзд)`, callback_data: 'buy_subscription' }],
          [{ text: '🎁 Ввести промокод', callback_data: 'enter_promo' }],
          [{ text: '🏠 Меню', callback_data: 'menu' }]
        ]
      }
    }
  );
}

async function handleBuySubscription(chatId: number, userId: number) {
  const price = await getSubscriptionPrice();

  try {
    await bot.sendInvoice(
      chatId,
      'Premium подписка',                           // title
      '🔥 Безлимитный доступ к AI-анализу еды на 1 месяц', // description
      'subscription_1_month',                        // payload
      '',                                            // provider_token (пустой для Stars)
      'XTR',                                         // currency (XTR = Telegram Stars)
      [{ label: 'Подписка 1 мес', amount: price }]   // prices
    );
  } catch (error) {
    console.error('✗ Ошибка создания инвойса:', error);
    await bot.sendMessage(chatId, '❌ Ошибка создания платежа. Попробуй позже.');
  }
}

// ==================== ADMIN HANDLERS ====================

async function handleAdminStats(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const stats = await getBotStats();

  await bot.sendMessage(
    chatId,
    `📊 <b>Статистика бота</b>\n\n` +
    `👥 Всего пользователей: <b>${stats.totalUsers}</b>\n` +
    `⭐ Активных подписок: <b>${stats.activeSubscriptions}</b>\n` +
    `💰 Всего платежей: <b>${stats.totalPayments}</b>\n` +
    `🌟 Заработано звёзд: <b>${stats.totalStarsEarned}</b>\n\n` +
    `📈 Всего анализов: <b>${stats.totalAnalyses}</b>\n` +
    `🍽 Всего приёмов пищи: <b>${stats.totalMeals}</b>\n\n` +
    `📅 Сегодня:\n` +
    `• Новых юзеров: ${stats.todayUsers}\n` +
    `• Приёмов пищи: ${stats.todayMeals}`,
    { parse_mode: 'HTML' }
  );
}

async function handleAdminPromos(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const promos = await getAllPromos();

  if (promos.length === 0) {
    await bot.sendMessage(
      chatId,
      `🎁 <b>Промокоды</b>\n\nНет активных промокодов.\n\n` +
      `Создать: /newpromo КОД АНАЛИЗЫ [МАКС]`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const promoList = promos.slice(0, 10).map(p => {
    const status = p.isActive ? '✅' : '❌';
    const uses = p.maxUses ? `${p.usedCount}/${p.maxUses}` : `${p.usedCount}/∞`;
    return `${status} <code>${p.code}</code> — ${p.analysesCount} анализов (${uses})`;
  }).join('\n');

  await bot.sendMessage(
    chatId,
    `🎁 <b>Промокоды</b>\n\n${promoList}\n\n` +
    `Создать: /newpromo КОД АНАЛИЗЫ [МАКС]`,
    { parse_mode: 'HTML' }
  );
}

async function handleAdminSettings(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const price = await getSubscriptionPrice();

  await bot.sendMessage(
    chatId,
    `⚙️ <b>Настройки</b>\n\n` +
    `⭐ Цена подписки: <b>${price} звёзд</b>\n\n` +
    `Изменить цену: /setprice ЧИСЛО`,
    { parse_mode: 'HTML' }
  );
}

async function handleAdminTopUsers(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const users = await getTopUsers(10);

  const list = users.map((u, i) => {
    const name = u.username ? `@${u.username}` : u.firstName || u.telegramId;
    const sub = u.hasSubscription ? '⭐' : '';
    return `${i + 1}. ${name} — ${u.totalAnalysesUsed} анализов ${sub}`;
  }).join('\n');

  await bot.sendMessage(
    chatId,
    `👥 <b>Топ пользователей</b>\n\n${list}`,
    { parse_mode: 'HTML' }
  );
}

async function handleAdminPayments(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const payments = await getRecentPayments(10);

  if (payments.length === 0) {
    await bot.sendMessage(chatId, '💰 <b>Платежи</b>\n\nПока нет платежей', { parse_mode: 'HTML' });
    return;
  }

  const list = payments.map(p => {
    const name = p.user.username ? `@${p.user.username}` : p.user.telegramId;
    const date = p.createdAt.toLocaleDateString('ru-RU');
    return `${date} — ${name} — ${p.stars}⭐`;
  }).join('\n');

  await bot.sendMessage(
    chatId,
    `💰 <b>Последние платежи</b>\n\n${list}`,
    { parse_mode: 'HTML' }
  );
}
