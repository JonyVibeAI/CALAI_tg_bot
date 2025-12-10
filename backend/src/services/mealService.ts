import { prisma } from '../db/prisma';
import { MealType, MealSource } from '@prisma/client';
import { ParsedFoodItem, MealWithItems, TodayStats } from '../types';
import { parseMealFromText, parseMealFromImage } from '../ai/openaiClient';

interface CreateMealData {
  userId: number;
  date: Date;
  type: MealType;
  items: ParsedFoodItem[];
  source: MealSource;
}

export async function createMeal(data: CreateMealData): Promise<MealWithItems> {
  const totalCalories = data.items.reduce((sum, item) => sum + item.calories, 0);
  const totalProtein = data.items.reduce((sum, item) => sum + item.protein, 0);
  const totalFat = data.items.reduce((sum, item) => sum + item.fat, 0);
  const totalCarbs = data.items.reduce((sum, item) => sum + item.carbs, 0);

  const meal = await prisma.meal.create({
    data: {
      userId: data.userId,
      date: data.date,
      type: data.type,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      source: data.source,
      items: {
        create: data.items.map(item => ({
          name: item.name,
          grams: item.grams,
          calories: item.calories,
          protein: item.protein,
          fat: item.fat,
          carbs: item.carbs,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  return meal;
}

export async function createMealFromText(
  userId: number,
  date: Date,
  type: MealType,
  description: string
): Promise<MealWithItems> {
  const items = await parseMealFromText(description);
  
  return createMeal({
    userId,
    date,
    type,
    items,
    source: 'TEXT',
  });
}

export async function createMealFromImage(
  userId: number,
  date: Date,
  imageUrl: string
): Promise<MealWithItems> {
  const { items, mealType } = await parseMealFromImage(imageUrl);
  
  return createMeal({
    userId,
    date,
    type: mealType as MealType,
    items,
    source: 'PHOTO',
  });
}

export async function getTodayMeals(userId: number): Promise<TodayStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const meals = await prisma.meal.findMany({
    where: {
      userId,
      date: {
        gte: today,
        lt: tomorrow,
      },
    },
    include: {
      items: true,
    },
    orderBy: {
      date: 'asc',
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyCalories: true },
  });

  const totalCalories = meals.reduce((sum, meal) => sum + meal.totalCalories, 0);
  const totalProtein = meals.reduce((sum, meal) => sum + meal.totalProtein, 0);
  const totalFat = meals.reduce((sum, meal) => sum + meal.totalFat, 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + meal.totalCarbs, 0);

  return {
    meals,
    totalCalories,
    totalProtein,
    totalFat,
    totalCarbs,
    dailyCalories: user?.dailyCalories || null,
  };
}

export async function getMealsByDate(userId: number, date: string): Promise<TodayStats> {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const meals = await prisma.meal.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      items: true,
    },
    orderBy: {
      date: 'asc',
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyCalories: true },
  });

  const totalCalories = meals.reduce((sum, meal) => sum + meal.totalCalories, 0);
  const totalProtein = meals.reduce((sum, meal) => sum + meal.totalProtein, 0);
  const totalFat = meals.reduce((sum, meal) => sum + meal.totalFat, 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + meal.totalCarbs, 0);

  return {
    meals,
    totalCalories,
    totalProtein,
    totalFat,
    totalCarbs,
    dailyCalories: user?.dailyCalories || null,
  };
}

export async function deleteMeal(mealId: number, userId: number): Promise<boolean> {
  const meal = await prisma.meal.findFirst({
    where: {
      id: mealId,
      userId,
    },
  });

  if (!meal) {
    return false;
  }

  await prisma.meal.delete({
    where: { id: mealId },
  });

  return true;
}

export function determineMealType(hour: number): MealType {
  if (hour >= 5 && hour < 11) return 'BREAKFAST';
  if (hour >= 11 && hour < 16) return 'LUNCH';
  if (hour >= 16 && hour < 22) return 'DINNER';
  return 'SNACK';
}





