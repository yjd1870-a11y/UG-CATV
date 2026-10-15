import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Settings, X } from 'lucide-react';
import type { ManualDetail as Detail } from '../../features/manual/types';
import { manualApi } from '../../features/manual/api';
import { ManualText } from './ManualText';
import { ManualMedia } from './ManualMedia';
import { ManualAttachments } from './ManualAttachments';

export const ManualDetail: React.FC<{ id: string; onClose?: () => void }> = ({ id, onClose }) => {
  const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState(''); const [managing, setManaging] = useState(false);
  const refresh = useCallback(async () => { const next = await manualApi.detail(id); setDetail(next); }, [id]);
  const manageButton = useRef<HTMLButtonElement>(null);
  const closeManagement = () => { setManaging(false); requestAnimationFrame(() => manageButton.current?.scrollIntoView({ block: 'nearest' })); };
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setError(''); setManaging(false);
    manualApi.detail(id, controller.signal).then((next) => { if (!controller.signal.aborted) setDetail(next); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [id]);
  if (error) return <div className="rounded-xl bg-white p-6"><p role="alert" className="text-red-700">{error}</p><a href="/manual" className="mt-4 block text-teal-700">장비 목록으로 돌아가기</a></div>;
  if (!detail) return <p role="status" className="p-6">사용방법을 불러오는 중...</p>;
  const back = `/manual?category=${encodeURIComponent(detail.model.categoryId)}`;
  return <article className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="sticky top-0 z-10 flex justify-between gap-2 bg-white py-2"><a href={back} onClick={onClose ? (e) => { e.preventDefault(); onClose(); } : undefined} className="flex min-h-11 items-center gap-2 text-sm font-bold text-[#173B57]"><ArrowLeft size={18} />모델 목록</a><a href={back} onClick={onClose ? (e) => { e.preventDefault(); onClose(); } : undefined} className="flex min-h-11 items-center gap-1 text-sm">{onClose ? '팝업 닫기' : '목록으로'}<X size={18} /></a></div>
    <div><p className="mb-2 text-sm text-slate-500">{detail.model.categoryName} · {detail.model.manufacturer || '제조사 미등록'}</p><h1 className="flex items-center gap-3 break-words text-xl font-extrabold text-[#173B57] sm:text-2xl"><BookOpen className="shrink-0 text-teal-600" /><span className="min-w-0 [overflow-wrap:anywhere]">{detail.model.name} 사용방법</span></h1><div className="mt-3 flex flex-wrap items-center gap-2"><span className="max-w-full break-all rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700">선택 모델: {detail.model.name}</span><a href={back} onClick={onClose ? (e) => { e.preventDefault(); onClose(); } : undefined} className="flex min-h-11 items-center rounded-lg border px-3 text-sm">다른 모델 선택</a></div></div>
    <ManualText key={id} model={detail.model} canManage={detail.canManage} onSaved={(model) => setDetail((d) => d ? { ...d, model } : d)} />
    {detail.canManage && <button ref={manageButton} type="button" onClick={() => managing ? closeManagement() : setManaging(true)} aria-expanded={managing} aria-controls="manual-management-panel" className="flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold text-[#173B57]"><Settings size={16} />{managing ? '자료 관리 닫기' : '모델·첨부자료 관리'}</button>}
    {managing && <div id="manual-management-panel"><ManualAttachments key={id} detail={detail} refresh={refresh} onClose={closeManagement} /></div>}<ManualMedia key={id} assets={detail.assets} />
  </article>;
};
