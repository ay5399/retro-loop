"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

// 指定チームのメンバーであることを確認する（違えば /teams へ戻す）
async function requireMembership(teamId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  if (!membership) redirect("/teams");
}

// ふりかえりを作成する。前回ふりかえり（同チームの直近）を自動でリンクする。
export async function createRetrospective(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  // 直近のふりかえり＝新規作成分の「前回」
  const previous = await prisma.retrospective.findFirst({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const retro = await prisma.retrospective.create({
    data: {
      teamId,
      name,
      previousRetrospectiveId: previous?.id ?? null,
    },
  });

  revalidatePath(`/teams/${teamId}`);
  redirect(`/teams/${teamId}/retros/${retro.id}`);
}

// ─────────────────────────────────────────────
// 参加リンク（固定URL）＋承認制フロー
// ─────────────────────────────────────────────

// 参加リンク経由の参加申請。/join/[token] のフォームから呼ばれる（ログイン必須）。
// - 既にメンバー → そのままチームへ
// - 承認不要(joinApproval=false) → 即メンバー化してチームへ
// - 承認制(true) → JoinRequest を PENDING で作成/更新し、申請ページへ戻す
export async function requestToJoin(joinToken: string) {
  const user = await requireUser();

  const team = await prisma.team.findUnique({
    where: { joinToken },
    select: { id: true, joinApproval: true },
  });
  if (!team) redirect("/teams");

  // 既にメンバーなら申請不要
  const existing = await prisma.membership.findUnique({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
  });
  if (existing) redirect(`/teams/${team.id}`);

  // 承認不要チームはその場で参加
  if (!team.joinApproval) {
    await prisma.membership.create({ data: { userId: user.id, teamId: team.id } });
    // 過去の申請が残っていれば承認済みに整合させる
    await prisma.joinRequest.updateMany({
      where: { teamId: team.id, userId: user.id },
      data: { status: "APPROVED" },
    });
    redirect(`/teams/${team.id}`);
  }

  // 承認制：PENDING で申請（再申請＝却下後でも PENDING に戻す）。1ユーザー1チーム1件。
  await prisma.joinRequest.upsert({
    where: { teamId_userId: { teamId: team.id, userId: user.id } },
    create: { teamId: team.id, userId: user.id, status: "PENDING" },
    update: { status: "PENDING" },
  });

  revalidatePath(`/join/${joinToken}`);
  redirect(`/join/${joinToken}`);
}

// 参加申請を承認する（メンバーなら誰でも可）。Membership を作り申請を APPROVED に。
export async function approveJoinRequest(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  const reqRow = await prisma.joinRequest.findFirst({
    where: { id: requestId, teamId, status: "PENDING" },
  });
  if (!reqRow) return;

  await prisma.membership.upsert({
    where: { userId_teamId: { userId: reqRow.userId, teamId } },
    create: { userId: reqRow.userId, teamId },
    update: {},
  });
  await prisma.joinRequest.update({
    where: { id: reqRow.id },
    data: { status: "APPROVED" },
  });

  revalidatePath(`/teams/${teamId}`);
}

// 参加申請を却下する（メンバーなら誰でも可）。
export async function rejectJoinRequest(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  await prisma.joinRequest.updateMany({
    where: { id: requestId, teamId, status: "PENDING" },
    data: { status: "REJECTED" },
  });

  revalidatePath(`/teams/${teamId}`);
}

// 参加リンクを再生成する（漏洩時など）。旧リンクは無効になる。
export async function regenerateJoinToken(teamId: string) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  await prisma.team.update({
    where: { id: teamId },
    data: { joinToken: crypto.randomUUID() },
  });

  revalidatePath(`/teams/${teamId}`);
}

// 参加リンク経由の承認要否を切り替える。
export async function setJoinApproval(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const approval = String(formData.get("approval") ?? "") === "true";
  await prisma.team.update({
    where: { id: teamId },
    data: { joinApproval: approval },
  });

  revalidatePath(`/teams/${teamId}`);
}
