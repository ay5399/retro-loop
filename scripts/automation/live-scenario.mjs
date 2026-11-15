/** Keep the synthetic user's date in the future, and persist exactly that user's content. */
export function actionScenario(now = new Date()) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('Synthetic action scenario needs a valid date');
  const date = new Date(time + (7 * 24 + 9) * 3600_000).toISOString().slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  return {
    date,
    inputs: [
      '自分のProblemはレビュー待ちが長いことです。前回のTry付箋は「自分のPRにレビュー希望時刻を書く」で、今回も同じProblemがあります。前回からの積み残しを確認して、次の行動を具体化したいです。',
      '前回のTryは実施済みですが、待ち時間は残りました。自分でできる次の行動にしたいです。担当者や期限はまだ決めていません。勝手に決めず、必要なことを一つ質問して。',
      `担当は私。${year}年${month}月${day}日の朝会後に、自分のPRへレビュー希望時刻を記載してチームに共有します。保存前に確認できる形でまとめて。`,
    ],
    saved: `担当：私／日付：${date} 朝会後／行動：自分のPRにレビュー希望時刻を記載し、チームへ共有する`,
  };
}
