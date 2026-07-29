-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "plLine" TEXT NOT NULL,
    "expenseMonth" TEXT NOT NULL,
    "invoiceDate" TEXT,
    "billingPeriod" TEXT,
    "vendor" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'transfer',
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" TEXT,
    "note" TEXT,
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rooms" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "waterBar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_expenseMonth_idx" ON "expenses"("expenseMonth");

-- CreateIndex
CREATE INDEX "expenses_plLine_idx" ON "expenses"("plLine");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_entries_month_key" ON "revenue_entries"("month");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
