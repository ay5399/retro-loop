"use server";

import { revalidatePath } from "next/cache";
import { NoteKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { reflect, llmModelLabel, type ReflectionInput } from "@/lib/llm/reflection";

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

// AI案を採用してアクション化する（採用分が次回の判定対象＝ループを閉じる）
export async function adoptProposedAction(
  teamId: string,
  retroId: string,
  formData: FormData,
) {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  const content = String(formData.get("content") ?? "").trim();
  const reflectionId = String(formData.get("reflectionId") ?? "").trim() || null;
  if (!content) return;

  await prisma.action.create({
    data: {
      teamId,
      createdInRetrospectiveId: retroId,
      sourceReflectionId: reflectionId,
      content,
    },
  });
  revalidateRetro(teamId, retroId);
}

// AI問い返しを実行する（差別化の核）
// 付箋＋前回OPENアクション＋ナレッジを渡し、判定・問い返し・新アクション案を得て保存する。
export async function runReflection(teamId: string, retroId: string) {
  const user = await requireUser();

  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    include: { notes: true },
  });
  if (!retro) throw new Error("アクセス権がありません");

  // 前回ふりかえりの OPEN アクション（判定対象）
  const previousActions = retro.previousRetrospectiveId
    ? await prisma.action.findMany({
        where: { createdInRetrospectiveId: retro.previousRetrospectiveId, status: "OPEN" },
        select: { id: true, content: true },
      })
    : [];

  // ナレッジ：チームの過去アクションと最新の判定
  const past = await prisma.action.findMany({
    where: { teamId },
    include: { evaluations: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const input: ReflectionInput = {
    notes: retro.notes.map((n) => ({ kind: n.kind, content: n.content })),
    previousActions,
    knowledge: past.map((a) => ({
      action: a.content,
      outcome: a.evaluations[0]?.outcome ?? null,
      reason: a.evaluations[0]?.reason ?? null,
    })),
  };

  const result = await reflect(input);

  // Reflection を保存
  await prisma.reflection.create({
    data: {
      retrospectiveId: retroId,
      model: llmModelLabel(),
      questions: result.probes as unknown as Prisma.InputJsonValue,
      rawOutput: result as unknown as Prisma.InputJsonValue,
    },
  });

  // 前回アクションの判定を保存（AIが実在する前回アクションを指したものだけ）
  const validIds = new Set(previousActions.map((a) => a.id));
  for (const ev of result.evaluations) {
    if (!validIds.has(ev.actionId)) continue;
    await prisma.actionEvaluation.upsert({
      where: {
        actionId_evaluatedInRetrospectiveId: {
          actionId: ev.actionId,
          evaluatedInRetrospectiveId: retroId,
        },
      },
      create: {
        actionId: ev.actionId,
        evaluatedInRetrospectiveId: retroId,
        outcome: ev.outcome,
        source: "AI",
        reason: ev.reason,
        question: ev.question,
      },
      update: {
        outcome: ev.outcome,
        source: "AI",
        reason: ev.reason,
        question: ev.question,
      },
    });
    // 効いた → アクション完了
    if (ev.outcome === "WORKED") {
      await prisma.action.update({ where: { id: ev.actionId }, data: { status: "DONE" } });
    }
  }

  revalidateRetro(teamId, retroId);
}
