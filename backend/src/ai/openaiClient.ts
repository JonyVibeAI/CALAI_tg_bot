import OpenAI from 'openai';
import { config } from '../config/env';
import { ParsedFoodItem } from '../types';

// Логируем настройки при старте
console.log('═══════════════════════════════════════');
console.log('🤖 Инициализация OpenAI клиента...');
console.log('📍 Base URL:', config.openaiBaseUrl || 'https://api.openai.com/v1 (по умолчанию)');
console.log('🔑 API Key:', config.openaiApiKey ? `${config.openaiApiKey.substring(0, 10)}...` : 'НЕ ЗАДАН!');
console.log('📝 Text Model:', config.openaiModelText);
console.log('📷 Vision Model:', config.openaiModelVision);
console.log('═══════════════════════════════════════');

// Создаём клиент с опциональным прокси
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

export async function parseMealFromText(description: string): Promise<ParsedFoodItem[]> {
  console.log('📝 parseMealFromText вызван с:', description.substring(0, 50));
  
  try {
    const response = await openai.chat.completions.create({
      model: config.openaiModelText,
      messages: [
        { 
          role: 'system', 
          content: `You are a nutrition assistant. Return ONLY valid JSON with "items" array.
Each item must have: name, grams, calories, protein, fat, carbs.
Example: {"items":[{"name":"Egg","grams":50,"calories":78,"protein":6,"fat":5,"carbs":0.6}]}`
        },
        { role: 'user', content: `Parse this meal: ${description}` }
      ],
      temperature: 0.3,
    });

    console.log('✓ Ответ получен от OpenAI Text');

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Нет ответа от OpenAI');
    }

    console.log('📝 Raw ответ:', content.substring(0, 200));

    // Извлекаем JSON
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    
    console.log('✓ Распознано продуктов:', items.length);
    
    return items.map((item: any) => ({
      name: item.name || 'Неизвестно',
      grams: Number(item.grams) || 100,
      calories: Math.round(Number(item.calories) || 0),
      protein: Number(item.protein) || 0,
      fat: Number(item.fat) || 0,
      carbs: Number(item.carbs) || 0,
    }));
  } catch (error: any) {
    console.error('═══════════════════════════════════════');
    console.error('✗ ОШИБКА parseMealFromText');
    console.error('✗ Тип:', error.constructor.name);
    console.error('✗ Сообщение:', error.message);
    if (error.status) console.error('✗ HTTP статус:', error.status);
    if (error.code) console.error('✗ Код ошибки:', error.code);
    if (error.error) console.error('✗ Детали:', JSON.stringify(error.error));
    console.error('═══════════════════════════════════════');
    throw new Error('Не удалось распознать еду');
  }
}

export async function parseMealFromImage(imageDataUri: string): Promise<{items: ParsedFoodItem[], mealType: string}> {
  console.log('📷 parseMealFromImage вызван');
  console.log('📷 Размер base64:', imageDataUri.length, 'символов');
  console.log('📷 Начало данных:', imageDataUri.substring(0, 50));
  
  try {
    console.log('🚀 Отправляю запрос в OpenAI Vision...');
    console.log('🚀 Модель:', config.openaiModelVision);
    
    const response = await openai.chat.completions.create({
      model: config.openaiModelVision,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this food image. Return ONLY valid JSON.
Format: {"mealType":"SNACK","items":[{"name":"Apple","grams":180,"calories":95,"protein":0.5,"fat":0.3,"carbs":25}]}
mealType must be: BREAKFAST, LUNCH, DINNER, or SNACK`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUri
              }
            }
          ]
        }
      ],
      max_tokens: 500,
    });

    console.log('✓ Получен ответ от OpenAI Vision');
    console.log('📦 Full response:', JSON.stringify(response, null, 2));
    
    const choice = response.choices[0];
    console.log('📦 Choice:', JSON.stringify(choice, null, 2));
    
    // Проверяем разные варианты где может быть контент
    const content = choice?.message?.content;
    const refusal = (choice?.message as any)?.refusal;
    
    if (refusal) {
      console.error('⚠️ Модель отказалась:', refusal);
      throw new Error(`Модель отказалась анализировать: ${refusal}`);
    }
    
    if (!content) {
      console.error('⚠️ Content пустой, finish_reason:', choice?.finish_reason);
      throw new Error('Нет ответа от OpenAI Vision');
    }

    console.log('📝 Raw ответ:', content);

    // Извлекаем JSON из ответа
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    const items = (parsed.items || []).map((item: any) => ({
      name: item.name || 'Неизвестная еда',
      grams: Number(item.grams) || 100,
      calories: Math.round(Number(item.calories) || 0),
      protein: Number(item.protein) || 0,
      fat: Number(item.fat) || 0,
      carbs: Number(item.carbs) || 0,
    }));
    
    console.log('✓ Распознано продуктов:', items.length);
    console.log('✓ Тип приема:', parsed.mealType);
    
    return {
      items,
      mealType: parsed.mealType || 'SNACK'
    };
  } catch (error: any) {
    console.error('═══════════════════════════════════════');
    console.error('✗ ОШИБКА parseMealFromImage');
    console.error('✗ Тип:', error.constructor.name);
    console.error('✗ Сообщение:', error.message);
    if (error.status) console.error('✗ HTTP статус:', error.status);
    if (error.code) console.error('✗ Код ошибки:', error.code);
    if (error.error) console.error('✗ Детали:', JSON.stringify(error.error));
    console.error('═══════════════════════════════════════');
    throw new Error('Не удалось распознать еду на фото');
  }
}
