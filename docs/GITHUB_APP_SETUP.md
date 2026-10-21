# 自動改善用GitHub Appの登録

追加のGitHubユーザーは不要。所有者ay5399のアカウントに非公開Appを作り、retro-loopだけへインストールする。登録・権限付与と鍵の生成は本人がGitHubの画面で行う。鍵の中身やトークンをチャットに貼らない。

1. https://github.com/settings/apps/new を所有者として開く。
2. GitHub App name: `retro-loop-improvement-ay5399`（使用済みなら末尾を変える）。
3. Homepage URL: `https://github.com/ay5399/retro-loop`。
4. Callback URL / Setup URL は空欄。Request user authorization / Device Flow はオフ。WebhookのActiveをオフ。
5. Repository permissionsを次の表のとおり設定。それ以外のRepository permissions、Organization permissions、Account permissionsはNo access。Metadataは自動設定される。

| 権限 | 設定 | 用途 |
|---|---|---|
| Contents | Read and write | 候補ブランチのpush・PRマージ |
| Actions | Read and write | 検証・配信workflowの起動と結果取得 |
| Issues | Read and write | 改善記録・提案 |
| Pull requests | Read and write | PR作成・マージ |
| Checks | Read and write | CI結果へのアクセス。所有者が書き込みも許可 |
| Administration | Read-only | mainのルール設定確認 |
| Environments | Read-only | productionの配信対象制限確認 |
| Metadata | Read-only | リポジトリ情報 |

Secrets、Variables、Workflowsと管理設定の書き込み権限は付けない。コード内の`appPermissions`を権限の上限とし、余分な権限や書き込みへの引き上げは拒否する。Appをブランチ保護ルールのbypassへ追加しない。通常改善の保護対象・レビュー・CI・費用監査も維持する。

6. Where can this GitHub App be installed? はOnly on this account。Create GitHub Appで登録。
7. 登録後の設定画面で**App ID**を控える（Client IDではない）。左メニューの **Credentials → Key pairs → New key** でPEMをダウンロードし、`%LOCALAPPDATA%/RetroLoopAutomation/`へ移す。旧UIではGeneral内のPrivate keys → Generate a private key。インストール先を選ぶ設定画面とは別。リポジトリ内へ保存しない。現行手順: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
8. Install Appから自分のアカウントを選び、**Only select repositories → retro-loop**だけを選択してInstall。All repositoriesにはしない。
9. インストール設定画面のURL末尾、`/settings/installations/数字`の数字がInstallation ID。
10. App ID・Installation ID・PEMの保存先だけを担当エージェントへ伝える。値を受け取った後、担当エージェントは以下の接続処理でAPIを使い、実際の権限・対象・認証を検証してから登録する。

```powershell
$env:RETRO_AUTOMATION_HOME = "$env:LOCALAPPDATA/RetroLoopAutomation"
node scripts/automation/connect-github-app.mjs <AppID> <InstallationID> <PEMの絶対パス>
node "$env:RETRO_AUTOMATION_HOME/runtime/run.mjs" --dry-run
```

所有者のghログイン、Windows全体やユーザー全体の環境変数は変更しない。ランナーのghとGitだけが短期Appトークンを使う。他プロジェクトで起動したCodex・Claude Codeの認証には影響しない。トークンは1時間有効、期限5分前から再発行する。モデル子プロセスへトークンを継承しない。Appが未登録・対象違い・必須権限不足・リポジトリ外の権限を持つ場合は、所有者認証へフォールバックせず停止する。Appを導入しても費用監査の未確認は解除しない。

Windowsユーザー共用という所有者方針のため、同じユーザーの他の資格情報をOSレベルで隔離するものではない。コード生成プロセスに渡す環境変数とコントローラーの認証経路を限定している。
