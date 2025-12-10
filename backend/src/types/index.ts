import { User, Meal, MealItem } from '@prisma/client';

export interface ParsedFoodItem {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface MealWithItems extends Meal {
  items: MealItem[];
}

export interface UserWithMeals extends User {
  meals: MealWithItems[];
}

export interface JWTPayload {
  userId: number;
  telegramId: string;
}

export interface TodayStats {
  meals: MealWithItems[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  dailyCalories: number | null;
}

export interface DayStats extends TodayStats {
  date: string;
}






