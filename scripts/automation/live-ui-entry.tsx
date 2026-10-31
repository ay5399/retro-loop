import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AiChat } from '../../src/app/teams/[teamId]/retros/[retroId]/ai-chat';
import { KptBoardClient } from '../../src/app/teams/[teamId]/retros/[retroId]/kpt-board.client';
import { getNotes } from './live-ui-store';
function Fixture() {
  const [notes, setNotes] = useState(getNotes);
  useEffect(() => {
    const update = () => setNotes(getNotes());
    window.addEventListener('fixture-saved', update);
    return () => window.removeEventListener('fixture-saved', update);
  }, []);
  return <main style={{ maxWidth: 1100, margin: '30px auto', padding: 20 }}>
    <h1>RetroLoop 実AI検証</h1>
    <p>架空データ・保存先は検証ブラウザー内。本番DB・認証は使用しません。</p>
    <KptBoardClient teamId="live-fixture" retroId="live-fixture" notes={notes} votesUsed={0} groups={[]} />
    <h2>AIアシスタント</h2>
    <AiChat teamId="live-fixture" retroId="live-fixture" userId="live-fixture-user" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
