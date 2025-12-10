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

export async function parseMealFromImage(imageUrl: string): Promise<{items: ParsedFoodItem[], mealType: string}> {
  try {
    const systemPrompt = `You are a nutrition assistant analyzing food images. 
Identify all food items in the image and estimate:
- name: the food name
- grams: estimated portion size in grams
- calories: total calories for that portion
- protein: protein in grams
- fat: fat in grams
- carbs: carbs in grams

Also determine the meal type based on the food:
- BREAKFAST: eggs, pancakes, cereal, toast, coffee, etc.
- LUNCH: substantial meals like pasta, salads, sandwiches, main dishes
- DINNER: full meals with meat/fish, side dishes, heavier foods
- SNACK: fruits, chocolate bars, nuts, yogurt, small portions

Return ONLY a JSON object. Example:
{
  "mealType": "BREAKFAST",
  "items": [
    {
      "name": "Fried eggs",
      "grams": 120,
      "calories": 180,
      "protein": 18,
      "fat": 27,
      "carbs": 2
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: config.openaiModelVision,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this food image, identify all items with nutritional information, and determine the meal type:'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Нет ответа от OpenAI Vision');
    }

    const parsed = JSON.parse(content);
    const items = (parsed.items || []).map((item: any) => ({
      name: item.name || 'Неизвестная еда',
      grams: Number(item.grams) || 100,
      calories: Math.round(Number(item.calories) || 0),
      protein: Number(item.protein) || 0,
      fat: Number(item.fat) || 0,
      carbs: Number(item.carbs) || 0,
    }));
    
    return {
      items,
      mealType: parsed.mealType || 'SNACK'
    };
  } catch (error) {
    console.error('✗ Ошибка анализа фото:', error);
    throw new Error('Не удалось распознать еду на фото');
  }
}





