import OpenAI from 'openai';
import { config } from '../config/env';
import { ParsedFoodItem } from '../types';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export async function parseMealFromText(description: string): Promise<ParsedFoodItem[]> {
  try {
    const systemPrompt = `You are a nutrition assistant. Convert meal descriptions into structured JSON.
For each food item, estimate:
- name: the food name
- grams: estimated portion size in grams
- calories: total calories for that portion
- protein: protein in grams
- fat: fat in grams  
- carbs: carbs in grams

Return ONLY a JSON array of items, no other text. Example format:
[
  {
    "name": "Chicken breast",
    "grams": 150,
    "calories": 248,
    "protein": 46.5,
    "fat": 5.4,
    "carbs": 0
  }
]`;

    const response = await openai.chat.completions.create({
      model: config.openaiModelText,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this meal: ${description}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Нет ответа от OpenAI');
    }

    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    
    return items.map((item: any) => ({
      name: item.name || 'Неизвестно',
      grams: Number(item.grams) || 100,
      calories: Math.round(Number(item.calories) || 0),
      protein: Number(item.protein) || 0,
      fat: Number(item.fat) || 0,
      carbs: Number(item.carbs) || 0,
    }));
  } catch (error) {
    console.error('✗ Ошибка парсинга текста:', error);
    throw new Error('Не удалось распознать еду');
  }
}

export async function parseMealFromImage(imageDataUri: string): Promise<{items: ParsedFoodItem[], mealType: string}> {
  try {
    console.log('🤖 Отправляю запрос в OpenAI Vision...');
    console.log('📷 Размер base64:', imageDataUri.length, 'символов');
    
    const response = await openai.chat.completions.create({
      model: config.openaiModelVision,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this food image. Identify all food items and estimate nutrition.

For each item provide:
- name (in Russian)
- grams (portion size)
- calories
- protein
- fat
- carbs

Also determine meal type: BREAKFAST, LUNCH, DINNER, or SNACK

Respond ONLY with valid JSON in this exact format:
{
  "mealType": "SNACK",
  "items": [
    {"name": "Яблоко", "grams": 180, "calories": 95, "protein": 0.5, "fat": 0.3, "carbs": 25}
  ]
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUri,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
    });

    console.log('✓ Получен ответ от OpenAI');

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Нет ответа от OpenAI Vision');
    }

    console.log('📝 Ответ OpenAI:', content);

    // Извлекаем JSON из ответа (может быть обёрнут в ```json ... ```)
    let jsonStr = content.trim();
    
    // Убираем markdown code blocks если есть
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
    
    return {
      items,
      mealType: parsed.mealType || 'SNACK'
    };
  } catch (error) {
    console.error('✗ Ошибка анализа фото:', error);
    if (error instanceof Error) {
      console.error('✗ Сообщение:', error.message);
    }
    throw new Error('Не удалось распознать еду на фото');
  }
}
