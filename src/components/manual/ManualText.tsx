import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { ManualModel } from '../../features/manual/types';
import { manualApi } from '../../features/manual/api';

export const ManualText: React.FC<{ model: ManualModel; canManage: boolean; onSaved: (model: ManualModel) => void }> = ({ model, canManage, onSaved }) => {
  const [editing, setEditing] = useState(false); const [body, setBody] = useState(''); const [tips, setTips] = useState('');
  const [version, setVersion] = useState(model.version); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const start = () => { setBody(model.body); setTips(model.tips); setVersion(model.version); setError(''); setEditing(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const next = await manualApi.text(model.id, { body, tips, version }); onSaved(next); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : '글을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="사용방법">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-extrabold text-[#173B57]">사용방법</h2>
      {canManage && !editing && <button onClick={start} className="flex min-h-11 items-center gap-2 text-sm font-bold text-blue-600"><Pencil size={16} />글 추가·수정</button>}</div>
    {editing ? <form onSubmit={save} className="space-y-4">
      <label className="block font-bold text-sm">사용방법 글<textarea aria-label="사용방법 글" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} rows={7} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="현장에서 참고할 사용방법을 입력하세요." /></label>
      <label className="block font-bold text-sm">현장 팁<textarea aria-label="현장 팁" value={tips} onChange={(e) => setTips(e.target.value)} maxLength={10000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="자주 확인하는 내용과 주의사항을 남겨주세요." /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setEditing(false)} className="min-h-11 rounded-lg border px-5">취소</button><button disabled={busy} className="min-h-11 rounded-lg bg-teal-600 px-6 font-bold text-white disabled:opacity-50">{busy ? '저장 중...' : '저장'}</button></div>
    </form> : <div className="space-y-4 leading-7 text-slate-700">
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{model.body || '등록된 사용방법이 없습니다.'}</p>
      {model.tips && <div><h3 className="font-bold text-[#173B57]">현장 팁</h3><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{model.tips}</p></div>}
    </div>}
  </section>;
};
