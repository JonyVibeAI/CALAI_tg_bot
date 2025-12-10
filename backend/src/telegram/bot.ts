import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/env';
import { findOrCreateUser, getUserByTelegramId, updateUserCalories } from '../services/userService';
import { createMealFromText, createMealFromImage, determineMealType, getTodayMeals, getMealsByDate, deleteMeal } from '../services/mealService';

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
        { text: '📈 Статистика', callback_data: 'stats' }
      ]
    ]
  };
}

export function initializeBot() {
  console.log('✓ Бот запущен');

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    if (!user) return;

    try {
      await findOrCreateUser({
        telegramId: user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      });

      await bot.sendMessage(
        chatId,
        `👋 Привет, ${user.first_name}!\n\n` +
        `🔥 Твой персональный AI-трекер калорий\n\n` +
        `Просто отправь:\n` +
        `📸 Фото еды — AI распознает и посчитает все автоматически\n` +
        `📝 Текст — например: "2 яйца, овсянка 100г, банан"\n\n` +
        `🤖 AI сам определит тип приема пищи:\n` +
        `🍳 Завтрак • 🍽 Обед • 🍴 Ужин • 🍎 Перекус\n\n` +
        `👇 Используй меню для управления`,
        {
          reply_markup: getMainMenuKeyboard()
        }
      );
    } catch (error) {
      console.error('✗ Ошибка /start:', error);
      await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуй позже.');
    }
  });

  // /menu command
  bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      '📱 Главное меню:',
      { reply_markup: getMainMenuKeyboard() }
    );
  });

  // Handle callback queries (button clicks)
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

      if (data === 'today') {
        await handleTodayStats(chatId, dbUser.id);
      } else if (data === 'history') {
        await handleHistory(chatId, dbUser.id);
      } else if (data === 'profile') {
        await handleProfile(chatId, dbUser);
      } else if (data === 'goal') {
        await handleGoal(chatId, dbUser);
      } else if (data === 'stats') {
        await handleStats(chatId, dbUser.id);
      } else if (data === 'back_menu') {
        await bot.sendMessage(chatId, '📱 Главное меню:', { reply_markup: getMainMenuKeyboard() });
      } else if (data?.startsWith('history_')) {
        const daysAgo = parseInt(data.split('_')[1]);
        await handleHistoryDay(chatId, dbUser.id, daysAgo);
      } else if (data?.startsWith('delete_')) {
        const mealId = parseInt(data.split('_')[1]);
        await handleDeleteMeal(chatId, dbUser.id, mealId);
      } else if (data === 'set_goal') {
        await bot.sendMessage(
          chatId,
          '🎯 Напиши свою дневную цель калорий числом.\n\nНапример: 2000'
        );
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('✗ Ошибка callback:', error);
      await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  });

  // Handle text messages
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const user = msg.from;

    if (!user) return;

    try {
      const telegramId = user.id.toString();
      const dbUser = await getUserByTelegramId(telegramId);

      if (!dbUser) {
        await bot.sendMessage(chatId, 'Сначала нажми /start');
        return;
      }

      // Check if user is setting goal
      const calories = parseInt(msg.text);
      if (!isNaN(calories) && calories > 0 && calories < 10000) {
        await updateUserCalories(dbUser.id, calories);
        await bot.sendMessage(
          chatId,
          `✅ Цель установлена: ${calories} ккал/день`,
          { reply_markup: getMainMenuKeyboard() }
        );
        return;
      }

      await bot.sendMessage(chatId, '🔄 Анализирую еду...');

      const now = new Date();
      const mealType = determineMealType(now.getHours());

      const meal = await createMealFromText(dbUser.id, now, mealType, msg.text);

      const itemsList = meal.items
        .map((item) => `• ${item.name} (${item.grams}г) - ${item.calories} ккал`)
        .join('\n');

      await bot.sendMessage(
        chatId,
        `✅ Сохранено!\n\n` +
        `${MEAL_TYPE_EMOJI[meal.type]} <b>${MEAL_TYPE_RU[meal.type]}</b>\n\n` +
        `📋 Продукты:\n${itemsList}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📊 <b>Итого:</b>\n` +
        `🔥 Калории: <b>${meal.totalCalories}</b> ккал\n` +
        `💪 Белки: ${meal.totalProtein.toFixed(1)}г\n` +
        `🥑 Жиры: ${meal.totalFat.toFixed(1)}г\n` +
        `🍞 Углеводы: ${meal.totalCarbs.toFixed(1)}г`,
        {
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard()
        }
      );
    } catch (error: any) {
      console.error('✗ Ошибка текст:', error);
      await bot.sendMessage(
        chatId,
        `❌ Не удалось обработать: ${error.message || 'Попробуй еще раз'}`,
        { reply_markup: getMainMenuKeyboard() }
      );
    }
  });

  // Handle photos
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

      await bot.sendMessage(chatId, '🔄 Анализирую фото еды...');

      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);

      if (!file.file_path) {
        throw new Error('Не удалось получить файл');
      }

      const imageUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const now = new Date();

      const meal = await createMealFromImage(dbUser.id, now, imageUrl);

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
        {
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard()
        }
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

async function handleTodayStats(chatId: number, userId: number) {
  const stats = await getTodayMeals(userId);
  
  if (stats.meals.length === 0) {
    await bot.sendMessage(
      chatId,
      '📊 <b>Сегодня</b>\n\n' +
      'Еще нет записей.\n\n' +
      '📸 Отправь фото или текст с едой!',
      { 
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard() 
      }
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
    `📊 <b>Итого за день:</b>\n` +
    `🔥 Калории: <b>${stats.totalCalories}</b> ккал\n` +
    `💪 Белки: ${stats.totalProtein.toFixed(1)}г\n` +
    `🥑 Жиры: ${stats.totalFat.toFixed(1)}г\n` +
    `🍞 Углеводы: ${stats.totalCarbs.toFixed(1)}г${progress}`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}

async function handleHistory(chatId: number, userId: number) {
  await bot.sendMessage(
    chatId,
    '📝 <b>История приемов пищи</b>\n\nВыбери день:',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Сегодня', callback_data: 'history_0' }],
          [{ text: '📅 Вчера', callback_data: 'history_1' }],
          [{ text: '📅 2 дня назад', callback_data: 'history_2' }],
          [{ text: '📅 3 дня назад', callback_data: 'history_3' }],
          [{ text: '📅 Неделю назад', callback_data: 'history_7' }],
          [{ text: '◀️ Назад', callback_data: 'back_menu' }]
        ]
      }
    }
  );
}

async function handleHistoryDay(chatId: number, userId: number, daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const dateStr = date.toISOString().split('T')[0];
  
  const stats = await getMealsByDate(userId, dateStr);
  
  const dayName = daysAgo === 0 ? 'Сегодня' : daysAgo === 1 ? 'Вчера' : `${daysAgo} дня назад`;
  
  if (stats.meals.length === 0) {
    await bot.sendMessage(
      chatId,
      `📅 <b>${dayName}</b>\n\nНет записей за этот день.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'history' }]]
        }
      }
    );
    return;
  }

  const mealsList = stats.meals.map((meal) => {
    const time = new Date(meal.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const items = meal.items.map(i => `${i.name} (${i.grams}г)`).join(', ');
    return `${MEAL_TYPE_EMOJI[meal.type]} <b>${MEAL_TYPE_RU[meal.type]}</b> — ${time}\n   ${items}\n   ${meal.totalCalories} ккал`;
  }).join('\n\n');

  const keyboard = {
    inline_keyboard: [
      ...stats.meals.map(meal => [{
        text: `🗑 Удалить ${MEAL_TYPE_RU[meal.type]}`,
        callback_data: `delete_${meal.id}`
      }]),
      [{ text: '◀️ Назад', callback_data: 'history' }]
    ]
  };

  await bot.sendMessage(
    chatId,
    `📅 <b>${dayName}</b>\n\n${mealsList}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📊 <b>Итого:</b>\n` +
    `🔥 Калории: <b>${stats.totalCalories}</b> ккал\n` +
    `💪 Белки: ${stats.totalProtein.toFixed(1)}г\n` +
    `🥑 Жиры: ${stats.totalFat.toFixed(1)}г\n` +
    `🍞 Углеводы: ${stats.totalCarbs.toFixed(1)}г`,
    { 
      parse_mode: 'HTML',
      reply_markup: keyboard 
    }
  );
}

async function handleDeleteMeal(chatId: number, userId: number, mealId: number) {
  const deleted = await deleteMeal(mealId, userId);
  
  if (deleted) {
    await bot.sendMessage(
      chatId,
      '✅ Прием пищи удален',
      { reply_markup: getMainMenuKeyboard() }
    );
  } else {
    await bot.sendMessage(
      chatId,
      '❌ Не удалось удалить',
      { reply_markup: getMainMenuKeyboard() }
    );
  }
}

async function handleProfile(chatId: number, user: any) {
  await bot.sendMessage(
    chatId,
    `👤 <b>Профиль</b>\n\n` +
    `Имя: ${user.firstName}${user.lastName ? ' ' + user.lastName : ''}\n` +
    `ID: ${user.telegramId}\n` +
    `🎯 Цель: ${user.dailyCalories ? `<b>${user.dailyCalories}</b> ккал` : 'не установлена'}\n\n` +
    `Используй кнопку "🎯 Цель" для настройки`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}

async function handleGoal(chatId: number, user: any) {
  await bot.sendMessage(
    chatId,
    `🎯 <b>Дневная цель калорий</b>\n\n` +
    `Текущая: ${user.dailyCalories ? `<b>${user.dailyCalories}</b> ккал` : 'не установлена'}\n\n` +
    `Нажми кнопку ниже и отправь число (например: 2000)`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Установить цель', callback_data: 'set_goal' }],
          [{ text: '◀️ Назад', callback_data: 'back_menu' }]
        ]
      }
    }
  );
}

async function handleStats(chatId: number, userId: number) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const stats = await getMealsByDate(userId, dateStr);
    days.push({ date: dateStr, calories: stats.totalCalories });
  }

  const maxCal = Math.max(...days.map(d => d.calories), 1);
  const statsText = days.map((day, i) => {
    const label = i === 0 ? 'Сегодня   ' : i === 1 ? 'Вчера     ' : day.date;
    const bars = '█'.repeat(Math.round((day.calories / maxCal) * 10));
    return `${label}: <b>${day.calories}</b> ккал\n${bars || '▪️'}`;
  }).join('\n\n');

  const avg = Math.round(days.reduce((sum, d) => sum + d.calories, 0) / days.length);
  const total = days.reduce((sum, d) => sum + d.calories, 0);

  await bot.sendMessage(
    chatId,
    `📈 <b>Статистика за неделю</b>\n\n${statsText}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📊 Среднее: <b>${avg}</b> ккал/день\n` +
    `🔥 Всего: <b>${total}</b> ккал`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}

export { bot };





