"use server";

import { revalidatePath } from "next/cache";
import { NoteKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

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
