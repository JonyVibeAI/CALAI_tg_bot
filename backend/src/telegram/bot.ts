import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
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
      }

      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('✗ Ошибка callback:', error);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка' });
    }
  });

  // Handle text messages (for meal input or goal setting)
  bot.on('message', async (msg) => {
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

      // Check if user is setting calorie goal (number only)
      if (/^\d+$/.test(text.trim())) {
        const dailyCalories = parseInt(text.trim());
        if (dailyCalories >= 1000 && dailyCalories <= 5000) {
          await updateUserCalories(dbUser.id, dailyCalories);
          await bot.sendMessage(
            chatId,
            `✅ Цель установлена: <b>${dailyCalories}</b> ккал/день`,
            {
              parse_mode: 'HTML',
              reply_markup: getMainMenuKeyboard()
            }
          );
          return;
        }
      }

      await bot.sendMessage(chatId, '🔄 Анализирую еду...');
      
      const now = new Date();
      const mealType = determineMealType(now.getHours());
      const meal = await createMealFromText(dbUser.id, now, text, mealType);

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
        {
          parse_mode: 'HTML',
          reply_markup: getMainMenuKeyboard()
        }
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

      // Скачиваем фото как base64
      const imageUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      console.log('📸 Скачиваю фото...');
      const imageBase64 = await downloadImageAsBase64(imageUrl);
      console.log('✓ Фото скачано, отправляю в OpenAI...');
      
      const now = new Date();
      const meal = await createMealFromImage(dbUser.id, now, imageBase64);

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
  const last7Days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    last7Days.push(date);
  }

  const historyData = await Promise.all(
    last7Days.map(async (date) => {
      const stats = await getMealsByDate(userId, date);
      return {
        date,
        ...stats
      };
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
    `📝 <b>История за неделю</b>\n\n${historyList}\n\n` +
    `Нажми на дату для подробностей`,
    { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...last7Days.slice(0, 3).map(date => [{
            text: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', weekday: 'short' }),
            callback_data: `history_day_${date.toISOString().split('T')[0]}`
          }]),
          ...last7Days.slice(3, 6).map(date => [{
            text: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', weekday: 'short' }),
            callback_data: `history_day_${date.toISOString().split('T')[0]}`
          }]),
          [{ text: '🏠 Главное меню', callback_data: 'today' }]
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
      `📅 <b>${date.toLocaleDateString('ru-RU')}</b>\n\n` +
      'Нет записей',
      { 
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard() 
      }
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
    `🔥 Калории: <b>${stats.totalCalories}</b> ккал\n` +
    `💪 Белки: ${stats.totalProtein.toFixed(1)}г\n` +
    `🥑 Жиры: ${stats.totalFat.toFixed(1)}г\n` +
    `🍞 Углеводы: ${stats.totalCarbs.toFixed(1)}г`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}

async function handleProfile(chatId: number, user: any) {
  const info = [];
  if (user.firstName) info.push(`👤 Имя: ${user.firstName}`);
  if (user.username) info.push(`📱 Username: @${user.username}`);
  if (user.dailyCalories) info.push(`🎯 Цель: ${user.dailyCalories} ккал/день`);
  
  const statsText = info.length > 0 ? info.join('\n') : 'Профиль пуст';

  await bot.sendMessage(
    chatId,
    `👤 <b>Профиль</b>\n\n${statsText}`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}

async function handleGoal(chatId: number, user: any) {
  await bot.sendMessage(
    chatId,
    `🎯 <b>Дневная цель</b>\n\n` +
    (user.dailyCalories 
      ? `Текущая: <b>${user.dailyCalories}</b> ккал/день\n\n` 
      : 'Не установлена\n\n') +
    `Отправь число (например: 2000) чтобы установить новую цель`,
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
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
      return {
        date,
        calories: stats.totalCalories
      };
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
    { 
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard() 
    }
  );
}
