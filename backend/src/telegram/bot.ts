import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import { config } from '../config/env';
import { findOrCreateUser, getUserByTelegramId, updateUserCalories } from '../services/userService';
import { createMealFromText, createMealFromImage, determineMealType, getTodayMeals, getMealsByDate, deleteMeal } from '../services/mealService';
import { checkUserAccess, useAnalysis, getUserSubscriptionInfo, getSubscriptionPrice, activateSubscription, setSetting, getSetting, getFreeAnalysesCount, getRequiredChannels, isChannelCheckEnabled } from '../services/subscriptionService';
import { activatePromo, createPromo, getAllPromos, deactivatePromo } from '../services/promoService';
import { getBotStats, isAdmin, setAdmin, getTopUsers, getRecentPayments, getAllUserTelegramIds } from '../services/adminService';

// Состояние для рассылки
interface BroadcastState {
  text?: string;
  photoFileId?: string;
  waitingFor: 'text' | 'photo' | 'confirm' | null;
}
const broadcastStates = new Map<number, BroadcastState>();

// Состояние для добавления канала
const addChannelStates = new Set<number>();

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
        `🔥 <b>ИИ-трекер калорий</b>\n\n` +
        `Просто отправь:\n` +
        `📸 Фото еды\n\n` +
        `${accessInfo}\n\n` +
        `👇 меню`,
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
            [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
            [{ text: '🎁 Промокоды', callback_data: 'admin_promos' }],
            [{ text: '⚙️ Настройки', callback_data: 'admin_settings' }],
            [{ text: '📺 Обяз. каналы', callback_data: 'admin_channels' }],
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

  // Установить количество бесплатных анализов
  bot.onText(/\/setfree\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;

    const isUserAdmin = await isAdmin(user.id.toString());
    if (!isUserAdmin && user.id.toString() !== config.adminTelegramId) {
      await bot.sendMessage(chatId, '⛔ Нет доступа');
      return;
    }

    const count = parseInt(match?.[1] || '0');
    if (count < 0) {
      await bot.sendMessage(chatId, '❌ Количество должно быть >= 0');
      return;
    }

    await setSetting('FREE_ANALYSES_COUNT', count.toString());
    await bot.sendMessage(chatId, `✅ Бесплатных анализов для новых юзеров: ${count}`);
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
      // Рассылка
      else if (data === 'admin_broadcast') {
        await handleAdminBroadcast(chatId, user.id.toString());
      } else if (data === 'broadcast_add_photo') {
        const state = broadcastStates.get(user.id) || { waitingFor: null };
        state.waitingFor = 'photo';
        broadcastStates.set(user.id, state);
        await bot.sendMessage(chatId, '📷 Отправь фото для рассылки:');
      } else if (data === 'broadcast_skip_photo') {
        const state = broadcastStates.get(user.id);
        if (state?.text) {
          state.waitingFor = 'confirm';
          broadcastStates.set(user.id, state);
          await showBroadcastPreview(chatId, user.id);
        }
      } else if (data === 'broadcast_send') {
        await executeBroadcast(chatId, user.id);
      } else if (data === 'broadcast_cancel') {
        broadcastStates.delete(user.id);
        await bot.sendMessage(chatId, '❌ Рассылка отменена', { reply_markup: getMainMenuKeyboard() });
      }
      // Каналы
      else if (data === 'admin_channels') {
        await handleAdminChannels(chatId, user.id.toString());
      } else if (data === 'channels_toggle') {
        const enabled = await isChannelCheckEnabled();
        await setSetting('CHANNEL_CHECK_ENABLED', enabled ? 'false' : 'true');
        await handleAdminChannels(chatId, user.id.toString());
      } else if (data === 'channels_add') {
        addChannelStates.add(user.id);
        await bot.sendMessage(chatId, '📺 Отправь @username или ID канала/бота:\n\nПример: @mychannel или -1001234567890');
      } else if (data?.startsWith('channels_remove_')) {
        const channel = data.replace('channels_remove_', '');
        const channels = await getRequiredChannels();
        const newChannels = channels.filter(c => c !== channel);
        await setSetting('REQUIRED_CHANNELS', newChannels.join(','));
        await bot.sendMessage(chatId, `✅ Канал ${channel} удалён`);
        await handleAdminChannels(chatId, user.id.toString());
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

    // Обработка состояния рассылки
    const broadcastState = broadcastStates.get(user.id);
    if (broadcastState?.waitingFor === 'text') {
      broadcastState.text = text;
      broadcastState.waitingFor = null;
      broadcastStates.set(user.id, broadcastState);
      await bot.sendMessage(chatId, '✅ Текст сохранён!\n\nХочешь добавить фото?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📷 Добавить фото', callback_data: 'broadcast_add_photo' }],
            [{ text: '⏭ Пропустить', callback_data: 'broadcast_skip_photo' }],
            [{ text: '❌ Отмена', callback_data: 'broadcast_cancel' }]
          ]
        }
      });
      return;
    }

    // Обработка добавления канала
    if (addChannelStates.has(user.id)) {
      addChannelStates.delete(user.id);
      const channel = text.trim();
      const channels = await getRequiredChannels();
      if (!channels.includes(channel)) {
        channels.push(channel);
        await setSetting('REQUIRED_CHANNELS', channels.join(','));
        await bot.sendMessage(chatId, `✅ Канал ${channel} добавлен`);
      } else {
        await bot.sendMessage(chatId, `⚠️ Канал уже в списке`);
      }
      await handleAdminChannels(chatId, user.id.toString());
      return;
    }

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

      // Проверяем подписку на обязательные каналы
      if (!await checkChannelSubscription(chatId, user.id)) return;

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

    // Обработка фото для рассылки
    const broadcastState = broadcastStates.get(user.id);
    if (broadcastState?.waitingFor === 'photo') {
      const photo = msg.photo[msg.photo.length - 1];
      broadcastState.photoFileId = photo.file_id;
      broadcastState.waitingFor = 'confirm';
      broadcastStates.set(user.id, broadcastState);
      await showBroadcastPreview(chatId, user.id);
      return;
    }

    try {
      const telegramId = user.id.toString();
      const dbUser = await getUserByTelegramId(telegramId);

      if (!dbUser) {
        await bot.sendMessage(chatId, 'Сначала нажми /start');
        return;
      }

      // Проверяем подписку на обязательные каналы
      if (!await checkChannelSubscription(chatId, user.id)) return;

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
      '🔥 Безлимитный доступ к ИИ-анализу еды на 1 месяц', // description
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
  const freeAnalyses = await getFreeAnalysesCount();

  await bot.sendMessage(
    chatId,
    `⚙️ <b>Настройки</b>\n\n` +
    `⭐ Цена подписки: <b>${price} звёзд</b>\n` +
    `🆓 Бесплатных анализов: <b>${freeAnalyses}</b>\n\n` +
    `<b>Команды:</b>\n` +
    `/setprice ЧИСЛО — изменить цену\n` +
    `/setfree ЧИСЛО — изменить кол-во бесплатных анализов`,
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

// ==================== РАССЫЛКА ====================

async function handleAdminBroadcast(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const userIds = await getAllUserTelegramIds();
  broadcastStates.set(parseInt(telegramId), { waitingFor: 'text' });

  await bot.sendMessage(
    chatId,
    `📢 <b>Рассылка</b>\n\n` +
    `👥 Получателей: <b>${userIds.length}</b>\n\n` +
    `✏️ Отправь текст для рассылки:`,
    { parse_mode: 'HTML' }
  );
}

async function showBroadcastPreview(chatId: number, telegramId: number) {
  const state = broadcastStates.get(telegramId);
  if (!state?.text) return;

  const userIds = await getAllUserTelegramIds();

  if (state.photoFileId) {
    await bot.sendPhoto(chatId, state.photoFileId, {
      caption: `📋 <b>Превью рассылки:</b>\n\n${state.text}\n\n👥 Получателей: ${userIds.length}`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Отправить', callback_data: 'broadcast_send' }],
          [{ text: '❌ Отмена', callback_data: 'broadcast_cancel' }]
        ]
      }
    });
  } else {
    await bot.sendMessage(
      chatId,
      `📋 <b>Превью рассылки:</b>\n\n${state.text}\n\n👥 Получателей: ${userIds.length}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Отправить', callback_data: 'broadcast_send' }],
            [{ text: '❌ Отмена', callback_data: 'broadcast_cancel' }]
          ]
        }
      }
    );
  }
}

async function executeBroadcast(chatId: number, telegramId: number) {
  const state = broadcastStates.get(telegramId);
  if (!state?.text) {
    await bot.sendMessage(chatId, '❌ Нет текста для рассылки');
    return;
  }

  const userIds = await getAllUserTelegramIds();
  let success = 0;
  let failed = 0;

  await bot.sendMessage(chatId, `⏳ Начинаю рассылку ${userIds.length} пользователям...`);

  for (const recipientId of userIds) {
    try {
      if (state.photoFileId) {
        await bot.sendPhoto(recipientId, state.photoFileId, {
          caption: state.text,
          parse_mode: 'HTML'
        });
      } else {
        await bot.sendMessage(recipientId, state.text, { parse_mode: 'HTML' });
      }
      success++;
    } catch (error) {
      failed++;
    }
    // Задержка чтобы не превысить лимиты Telegram
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  broadcastStates.delete(telegramId);

  await bot.sendMessage(
    chatId,
    `✅ <b>Рассылка завершена!</b>\n\n` +
    `📤 Отправлено: <b>${success}</b>\n` +
    `❌ Ошибок: <b>${failed}</b>\n` +
    `👥 Всего: ${userIds.length}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

// ==================== ОБЯЗАТЕЛЬНЫЕ КАНАЛЫ ====================

async function handleAdminChannels(chatId: number, telegramId: string) {
  const isUserAdmin = await isAdmin(telegramId);
  if (!isUserAdmin && telegramId !== config.adminTelegramId) return;

  const enabled = await isChannelCheckEnabled();
  const channels = await getRequiredChannels();

  let channelsList = 'Нет каналов';
  const removeButtons: any[] = [];

  if (channels.length > 0) {
    channelsList = channels.map((c, i) => `${i + 1}. ${c}`).join('\n');
    channels.forEach(c => {
      removeButtons.push([{ text: `🗑 Удалить ${c}`, callback_data: `channels_remove_${c}` }]);
    });
  }

  await bot.sendMessage(
    chatId,
    `📺 <b>Обязательные подписки</b>\n\n` +
    `${enabled ? '✅ Проверка ВКЛЮЧЕНА' : '❌ Проверка ВЫКЛЮЧЕНА'}\n\n` +
    `<b>Каналы:</b>\n${channelsList}`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: enabled ? '🔴 Выключить проверку' : '🟢 Включить проверку', callback_data: 'channels_toggle' }],
          [{ text: '➕ Добавить канал', callback_data: 'channels_add' }],
          ...removeButtons,
          [{ text: '🔙 Назад', callback_data: 'menu' }]
        ]
      }
    }
  );
}

async function checkChannelSubscription(chatId: number, telegramId: number): Promise<boolean> {
  const enabled = await isChannelCheckEnabled();
  if (!enabled) return true;

  const channels = await getRequiredChannels();
  if (channels.length === 0) return true;

  const notSubscribed: string[] = [];

  for (const channel of channels) {
    try {
      const member = await bot.getChatMember(channel, telegramId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        notSubscribed.push(channel);
      }
    } catch (error) {
      // Если не удалось проверить — считаем что не подписан
      notSubscribed.push(channel);
    }
  }

  if (notSubscribed.length > 0) {
    const channelLinks = notSubscribed.map(c => {
      if (c.startsWith('@')) {
        return `• <a href="https://t.me/${c.slice(1)}">${c}</a>`;
      }
      return `• ${c}`;
    }).join('\n');

    await bot.sendMessage(
      chatId,
      `⚠️ <b>Подпишись на каналы</b>\n\n` +
      `Чтобы использовать бота, подпишись:\n${channelLinks}\n\n` +
      `После подписки попробуй снова!`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
    return false;
  }

  return true;
}
