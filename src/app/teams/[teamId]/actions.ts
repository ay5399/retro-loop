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

// 招待受諾リンクのメールを Resend で送る（src/auth.ts と同じ fetch パターン）。
// 送信失敗は握りつぶす（招待リンクは UI でも表示するため）。
async function sendInvitationEmail(email: string, url: string) {
  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  if (process.env.NODE_ENV !== "production") {
    console.log(`\n📨 [DEV] ${email} へのチーム招待リンク:\n${url}\n`);
  }
  if (!apiKey) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: "RetroLoop チームへの招待",
        html: `<p>RetroLoop のチームに招待されました。</p><p><a href="${url}">招待を受諾する</a></p><p>心当たりがなければ、このメールは無視してください。</p>`,
        text: `RetroLoop のチームに招待されました。\n受諾リンク: ${url}\n心当たりがなければ無視してください。`,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    // 送信失敗はUIの招待リンク表示で代替できるため握りつぶす
    console.warn("[invite] Resend 送信に失敗:", e);
  }
}

// チームにメールアドレスを招待する。既存メンバーなら何もしない。
export async function createInvitation(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  // 簡易バリデート（最低限 x@y.z 形式）
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  // 既にそのメールの User がこのチームのメンバーなら招待不要
  const existingMember = await prisma.membership.findFirst({
    where: { teamId, user: { email } },
    select: { id: true },
  });
  if (existingMember) return;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7日後
  const invitation = await prisma.invitation.create({
    data: { teamId, email, expiresAt },
  });

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  await sendInvitationEmail(email, `${baseUrl}/invite/${invitation.token}`);

  revalidatePath(`/teams/${teamId}`);
}

// 招待を取り消す。
export async function revokeInvitation(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return;

  await prisma.invitation.deleteMany({ where: { id: invitationId, teamId } });

  revalidatePath(`/teams/${teamId}`);
}

// 招待を受諾する。トークンが有効ならメンバーに加え、招待を削除してチームへ。
export async function acceptInvitation(token: string) {
  const user = await requireUser();

  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.expiresAt < new Date()) {
    redirect("/teams");
  }

  await prisma.membership.upsert({
    where: { userId_teamId: { userId: user.id, teamId: invitation.teamId } },
    create: { userId: user.id, teamId: invitation.teamId },
    update: {},
  });
  await prisma.invitation.delete({ where: { id: invitation.id } });

  redirect(`/teams/${invitation.teamId}`);
}
