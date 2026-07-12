-- 個別メール招待(Invitation)を廃止し、固定URLの参加リンク＋承認制(JoinRequest)へ移行する。

-- 1) Invitation を廃止
DROP TABLE "Invitation";

-- 2) Team に参加リンク列を追加
--    joinToken は既存行があるため、いったん NULL 許可で追加→バックフィル→NOT NULL 化する。
ALTER TABLE "Team" ADD COLUMN "joinToken" TEXT;
ALTER TABLE "Team" ADD COLUMN "joinApproval" BOOLEAN NOT NULL DEFAULT true;

-- 既存 Team 行に一意なトークンを割り当てる（Postgres 組込みの gen_random_uuid）
UPDATE "Team" SET "joinToken" = gen_random_uuid()::text WHERE "joinToken" IS NULL;

-- バックフィル済みなので NOT NULL + UNIQUE を付与
ALTER TABLE "Team" ALTER COLUMN "joinToken" SET NOT NULL;
CREATE UNIQUE INDEX "Team_joinToken_key" ON "Team"("joinToken");

-- 3) JoinRequest の状態 enum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 4) JoinRequest テーブル
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JoinRequest_teamId_userId_key" ON "JoinRequest"("teamId", "userId");
CREATE INDEX "JoinRequest_teamId_status_idx" ON "JoinRequest"("teamId", "status");

ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
