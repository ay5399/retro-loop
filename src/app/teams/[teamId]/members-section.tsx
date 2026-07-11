import { createInvitation, revokeInvitation } from "./actions";
import { CopyLinkButton } from "./copy-link-button";

type Member = { id: string; email: string | null; name: string | null };
type Invite = { id: string; email: string; token: string; expiresAt: string };
type Props = {
  teamId: string;
  members: Member[];
  invitations: Invite[];
  baseUrl: string;
};

// 有効期限を読みやすい日本語表記に。パース不能ならそのまま返す。
function formatExpires(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MembersSection({ teamId, members, invitations, baseUrl }: Props) {
  const createForTeam = createInvitation.bind(null, teamId);
  const revokeForTeam = revokeInvitation.bind(null, teamId);

  return (
    <section className="space-y-6">
      {/* メンバー一覧 */}
      <div className="card space-y-3 p-5">
        <p className="eyebrow">Members</p>
        <ul className="divide-y divide-line">
          {members.map((member) => (
            <li
              key={member.id}
              data-member-row
              data-member-id={member.id}
              className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
            >
              <span className="font-display font-medium">
                {member.name ?? member.email ?? "（名前未設定）"}
              </span>
              {member.name && member.email ? (
                <span className="text-sm text-muted">{member.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {/* 招待フォーム */}
      <div className="card space-y-3 p-5">
        <p className="eyebrow">Invite</p>
        <form action={createForTeam} className="flex gap-2">
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@example.com"
            className="field"
            data-invite-email-input
          />
          <button type="submit" className="btn btn-primary shrink-0" data-invite-submit>
            招待
          </button>
        </form>
        <p className="text-xs text-muted">
          招待メールが届かない相手にも、下の招待リンクを手渡しで共有できます。
        </p>
      </div>

      {/* 保留中の招待一覧 */}
      {invitations.length > 0 ? (
        <div className="card space-y-3 p-5">
          <p className="eyebrow">Pending invitations</p>
          <ul className="divide-y divide-line">
            {invitations.map((invite) => {
              const link = `${baseUrl}/invite/${invite.token}`;
              return (
                <li
                  key={invite.id}
                  data-invitation-id={invite.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{invite.email}</span>
                    <form action={revokeForTeam}>
                      <input type="hidden" name="invitationId" value={invite.id} />
                      <button
                        type="submit"
                        className="btn btn-ghost btn-sm shrink-0"
                        data-invite-revoke
                      >
                        取り消し
                      </button>
                    </form>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
                      {link}
                    </code>
                    <CopyLinkButton link={link} />
                  </div>
                  <p className="text-xs text-muted">
                    有効期限：{formatExpires(invite.expiresAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
