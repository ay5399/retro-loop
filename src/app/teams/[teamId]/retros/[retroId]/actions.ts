"use server";

import { revalidatePath } from "next/cache";
import { NoteKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { isNoteColor, type NoteColor } from "@/lib/note-colors";
import { MAX_VOTES_PER_USER } from "@/lib/votes";

// このふりかえりが、ログインユーザーが所属するチームのものか確認する
async function assertRetroAccess(teamId: string, retroId: string, userId: string) {
  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId } } },
    },
    select: { id: true },
  });
  if (!retro) throw new Error("アクセス権がありません");
}

function revalidateRetro(teamId: string, retroId: string) {
  revalidatePath(`/teams/${teamId}/retros/${retroId}`);
}

// 付箋を追加
export async function addNote(
  teamId: string,
  retroId: string,
  kind: NoteKind,
  formData: FormData,
) {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;

  await prisma.note.create({
    data: { retrospectiveId: retroId, authorId: user.id, kind, content },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋を編集（自チームのふりかえりの付箋のみ）
export async function updateNote(
  teamId: string,
  retroId: string,
  noteId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;

  await prisma.note.updateMany({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: { content },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋の色を変更（null でデフォルトに戻す。不正値は無視）
export async function setNoteColor(
  teamId: string,
  retroId: string,
  noteId: string,
  color: NoteColor | null,
): Promise<void> {
  const user = await requireUser();

  // null（色なし）と有効なパレット値のみ許可。それ以外は無視。
  if (color !== null && !isNoteColor(color)) return;

  await prisma.note.updateMany({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: { color },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋を削除
export async function deleteNote(teamId: string, retroId: string, noteId: string) {
  const user = await requireUser();

  await prisma.note.deleteMany({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋をドラッグ移動して並び順を永続化する（レーン内移動 or レーン間移動）
export async function moveNote(
  teamId: string,
  retroId: string,
  input: { noteId: string; toKind: NoteKind; toIndex: number },
): Promise<void> {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  await prisma.$transaction(async (tx) => {
    // 対象付箋をメンバーシップ認可付きで取得
    const note = await tx.note.findFirst({
      where: {
        id: input.noteId,
        retrospectiveId: retroId,
        retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
      },
      select: { id: true, kind: true },
    });
    if (!note) return;

    const fromKind = note.kind;
    const toKind = input.toKind;

    // 移動先レーンの付箋（自分を除く）を order 昇順で取得
    const destNotes = await tx.note.findMany({
      where: {
        retrospectiveId: retroId,
        kind: toKind,
        id: { not: note.id },
      },
      orderBy: { order: "asc" },
      select: { id: true },
    });

    // toIndex に対象を挿入した並びを作る（範囲外は末尾へクランプ）
    const clampedIndex = Math.max(0, Math.min(input.toIndex, destNotes.length));
    const ordered: string[] = [
      ...destNotes.slice(0, clampedIndex).map((n) => n.id),
      note.id,
      ...destNotes.slice(clampedIndex).map((n) => n.id),
    ];

    // 0..n で連番を振り直す（対象付箋は kind も更新）。
    // ordered の全付箋は移動先レーン(toKind)に属するので kind を toKind に統一
    // （既存分は不変、対象付箋のみ実質変化）。1 文の UPDATE にまとめて往復を削減。
    if (ordered.length > 0) {
      const orderCases = ordered.map((id, i) => Prisma.sql`WHEN ${id} THEN ${i}`);
      await tx.$executeRaw`
        UPDATE "Note"
        SET "order" = CASE "id" ${Prisma.join(orderCases, " ")} END,
            "kind" = ${toKind}::"NoteKind"
        WHERE "id" IN (${Prisma.join(ordered)})
      `;
    }

    // レーンをまたいだ場合は元レーンも order を 0..n に詰め直す（同じく 1 文に集約）
    if (fromKind !== toKind) {
      // グループはレーン(kind)内の概念。別レーンへ移った付箋はグループから離脱させる
      await tx.note.update({
        where: { id: note.id },
        data: { groupId: null },
      });

      const fromNotes = await tx.note.findMany({
        where: {
          retrospectiveId: retroId,
          kind: fromKind,
          id: { not: note.id },
        },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      if (fromNotes.length > 0) {
        const fromCases = fromNotes.map((n, i) => Prisma.sql`WHEN ${n.id} THEN ${i}`);
        await tx.$executeRaw`
          UPDATE "Note"
          SET "order" = CASE "id" ${Prisma.join(fromCases, " ")} END
          WHERE "id" IN (${Prisma.join(fromNotes.map((n) => n.id))})
        `;
      }
    }
  });

  revalidateRetro(teamId, retroId);
}

// 付箋への投票をトグルする（Phase 3）。
// 既に投票済みなら取り消し、未投票ならこのふりかえり内の総票数が上限未満のときだけ投じる。
export async function toggleVote(
  teamId: string,
  retroId: string,
  noteId: string,
): Promise<void> {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  // 対象付箋が当該ふりかえりのもので、かつ自チームか確認（メンバーシップ付き）
  const note = await prisma.note.findFirst({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    select: { id: true },
  });
  if (!note) return;

  const existing = await prisma.noteVote.findUnique({
    where: { noteId_userId: { noteId, userId: user.id } },
    select: { id: true },
  });

  if (existing) {
    // 投票済み → 取り消し
    await prisma.noteVote.delete({
      where: { noteId_userId: { noteId, userId: user.id } },
    });
  } else {
    // 未投票 → このふりかえり内の総票数が上限未満のときだけ投じる
    const votesUsed = await prisma.noteVote.count({
      where: { userId: user.id, note: { retrospectiveId: retroId } },
    });
    if (votesUsed >= MAX_VOTES_PER_USER) return; // 上限
    await prisma.noteVote.create({
      data: { noteId, userId: user.id },
    });
  }

  revalidateRetro(teamId, retroId);
}

// 付箋をグループ化する（Phase 4）。
// 同一レーン(kind)内の2枚以上の付箋を1つの NoteGroup にまとめる。
export async function createGroup(
  teamId: string,
  retroId: string,
  input: { kind: NoteKind; noteIds: string[]; name?: string },
): Promise<void> {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  // 2枚未満はグループにならない
  if (input.noteIds.length < 2) return;

  // 対象付箋が全て当該ふりかえり所属・同一 kind であることを確認（メンバーシップ付き）
  const notes = await prisma.note.findMany({
    where: {
      id: { in: input.noteIds },
      retrospectiveId: retroId,
      kind: input.kind,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    select: { id: true },
  });
  // 件数不一致（別レーン/別ふりかえり/存在しないID混入）なら中止
  if (notes.length !== input.noteIds.length) return;

  const group = await prisma.noteGroup.create({
    data: {
      retrospectiveId: retroId,
      kind: input.kind,
      name: input.name ?? null,
      order: 0,
    },
  });

  await prisma.note.updateMany({
    where: {
      id: { in: input.noteIds },
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: { groupId: group.id },
  });

  revalidateRetro(teamId, retroId);
}

// グループ名を変更する
export async function renameGroup(
  teamId: string,
  retroId: string,
  groupId: string,
  name: string,
): Promise<void> {
  const user = await requireUser();

  await prisma.noteGroup.updateMany({
    where: {
      id: groupId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: { name },
  });

  revalidateRetro(teamId, retroId);
}

// グループを解除する（NoteGroup を削除。Note.groupId は onDelete SetNull で自動的に null）
export async function ungroup(
  teamId: string,
  retroId: string,
  groupId: string,
): Promise<void> {
  const user = await requireUser();

  await prisma.noteGroup.deleteMany({
    where: {
      id: groupId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
  });

  revalidateRetro(teamId, retroId);
}
