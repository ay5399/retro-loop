import { PrismaClient } from "@prisma/client";

// Next.js の開発時ホットリロードで PrismaClient が増殖しないよう
// グローバルにシングルトンを保持する（Prisma 公式の推奨パターン）。
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
