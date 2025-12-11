-- AlterTable: Add subscription fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionEnd" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "freeAnalysesLeft" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bonusAnalyses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totalAnalysesUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: Payment
CREATE TABLE IF NOT EXISTS "Payment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramPaymentId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Promo
CREATE TABLE IF NOT EXISTS "Promo" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "analysesCount" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PromoActivation
CREATE TABLE IF NOT EXISTS "PromoActivation" (
    "id" SERIAL NOT NULL,
    "promoId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoActivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Settings
CREATE TABLE IF NOT EXISTS "Settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_telegramPaymentId_key" ON "Payment"("telegramPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Promo_code_key" ON "Promo"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromoActivation_promoId_userId_key" ON "PromoActivation"("promoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Settings_key_key" ON "Settings"("key");

-- AddForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_userId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoActivation" DROP CONSTRAINT IF EXISTS "PromoActivation_promoId_fkey";
ALTER TABLE "PromoActivation" ADD CONSTRAINT "PromoActivation_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoActivation" DROP CONSTRAINT IF EXISTS "PromoActivation_userId_fkey";
ALTER TABLE "PromoActivation" ADD CONSTRAINT "PromoActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
