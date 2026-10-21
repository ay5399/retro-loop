// Synthetic browser fixture. Production server actions/DB are tested separately in CI.
type Note = { id: string; kind: 'KEEP' | 'PROBLEM' | 'TRY'; content: string; order: number; color: null; groupId: null; voteCount: number; hasVoted: boolean };
export function getNotes(): Note[] {
  const saved = localStorage.getItem('retro-live-fixture');
  return saved ? JSON.parse(saved) : [{ id: 'problem-fixture', kind: 'PROBLEM', content: 'コードレビューの待ち時間が長い', order: 0, color: null, groupId: null, voteCount: 0, hasVoted: false }];
}
export async function addNote(teamId: string, retroId: string, kind: Note['kind'], form: FormData) {
  if (teamId !== 'live-fixture' || retroId !== 'live-fixture') throw new Error('Fixture identifiers required');
  const notes = getNotes();
  notes.push({ id: crypto.randomUUID(), kind, content: String(form.get('content')), order: notes.length, color: null, groupId: null, voteCount: 0, hasVoted: false });
  localStorage.setItem('retro-live-fixture', JSON.stringify(notes));
  window.dispatchEvent(new Event('fixture-saved'));
}
async function unsupported() { throw new Error('This synthetic fixture only supports adding a Try note'); }
export { unsupported as updateNote, unsupported as deleteNote, unsupported as moveNote, unsupported as setNoteColor, unsupported as toggleVote, unsupported as createGroup, unsupported as renameGroup, unsupported as ungroup };
