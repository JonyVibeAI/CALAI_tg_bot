import { prisma } from '../db/prisma';
import { Gender, ActivityLevel, GoalType } from '@prisma/client';

interface CreateUserData {
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

interface UpdateProfileData {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  gender?: Gender;
  activityLevel?: ActivityLevel;
  goal?: GoalType;
}

export async function findOrCreateUser(data: CreateUserData) {
  let user = await prisma.user.findUnique({
    where: { telegramId: data.telegramId },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId: data.telegramId,
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
      },
    });
  }

  return user;
}

export async function getUserById(id: number) {
  return prisma.user.findUnique({
    where: { id },
  });
}

export async function getUserByTelegramId(telegramId: string) {
  return prisma.user.findUnique({
    where: { telegramId },
  });
}

export async function updateUserProfile(userId: number, data: UpdateProfileData) {
  const dailyCalories = calculateDailyCalories(data);
  
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...data,
      dailyCalories,
    },
  });
}

export async function updateUserCalories(userId: number, dailyCalories: number) {
  return prisma.user.update({
    where: { id: userId },
    data: { dailyCalories },
  });
}

function calculateDailyCalories(data: UpdateProfileData): number | null {
  const { age, heightCm, weightKg, gender, activityLevel, goal } = data;
  
  if (!age || !heightCm || !weightKg || !gender || !activityLevel || !goal) {
    return null;
  }

  // Mifflin-St Jeor equation
  let bmr: number;
  if (gender === 'MALE') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else if (gender === 'FEMALE') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 78;
  }

  // Activity multipliers
  const activityMultipliers = {
    SEDENTARY: 1.2,
    LIGHT: 1.375,
    MODERATE: 1.55,
    ACTIVE: 1.725,
    VERY_ACTIVE: 1.9,
  };

  const tdee = bmr * activityMultipliers[activityLevel];

  // Goal adjustments
  let dailyCalories: number;
  if (goal === 'LOSE_WEIGHT') {
    dailyCalories = tdee - 500; // 500 cal deficit
  } else if (goal === 'GAIN_WEIGHT') {
    dailyCalories = tdee + 300; // 300 cal surplus
  } else {
    dailyCalories = tdee;
  }

  return Math.round(dailyCalories);
}





