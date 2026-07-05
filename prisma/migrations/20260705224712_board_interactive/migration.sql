-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "color" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill: 既存付箋のレーン(retrospectiveId + kind)内順序を createdAt 順で 0..n に設定
UPDATE "Note" n SET "order" = s.rn - 1
FROM (
  SELECT id, row_number() OVER (
    PARTITION BY "retrospectiveId", "kind" ORDER BY "createdAt"
  ) AS rn
  FROM "Note"
) s WHERE n.id = s.id;

-- CreateTable
CREATE TABLE "NoteGroup" (
    "id" TEXT NOT NULL,
    "retrospectiveId" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL,
    "name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteVote" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteVote_noteId_userId_key" ON "NoteVote"("noteId", "userId");

-- CreateIndex
CREATE INDEX "Note_retrospectiveId_kind_order_idx" ON "Note"("retrospectiveId", "kind", "order");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "NoteGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteGroup" ADD CONSTRAINT "NoteGroup_retrospectiveId_fkey" FOREIGN KEY ("retrospectiveId") REFERENCES "Retrospective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteVote" ADD CONSTRAINT "NoteVote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteVote" ADD CONSTRAINT "NoteVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
