import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { apiResourceUrl } from '../../shared/api/client';
import { ccParticipationApi } from '../../features/home/cc-participation-api';
import { CC_MAX_SECTIONS, CC_PHOTO_MAX_BYTES, CC_INTRODUCTION_DEFAULT_COLOR, type CcParticipationDocument, type CcParticipationSection } from '../../features/home/cc-participation-process';
import { ManualPhotoInput } from '../manual/ManualPhotoInput';

const field = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm';
type Draft = CcParticipationSection & { file: File | null; inputKey: number };
type Props = { document: CcParticipationDocument; onSaved: (document: CcParticipationDocument) => void; onCancel: () => void; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void };

export const CcParticipationProcessEditor: React.FC<Props> = ({ document, onSaved, onCancel, onBusyChange, onDirtyChange }) => {
  const [introduction, setIntroduction] = useState(document.introduction);
  const [introductionColor, setIntroductionColor] = useState(document.introductionColor || CC_INTRODUCTION_DEFAULT_COLOR);
  const [bottomText, setBottomText] = useState(document.bottomText);
  const [sections, setSections] = useState<Draft[]>(() => Array.from({ length: CC_MAX_SECTIONS }, (_, index) => ({
    ...(document.sections[index] || { id: `cc-participation-${index + 1}`, title: '', description: '', photo: null }), file: null, inputKey: 0,
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [dirty, setDirty] = useState(false);
  const [processing, setProcessing] = useState<Set<number>>(() => new Set());
  useEffect(() => { onBusyChange(busy || processing.size > 0); }, [busy, processing.size, onBusyChange]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const changeSection = (index: number, update: Partial<Draft>) => {
    setSections((current) => current.map((section, position) => position === index ? { ...section, ...update } : section));
    setDirty(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || processing.size) return;
    setBusy(true); onBusyChange(true); setError('');
    const uploaded: string[] = [];
    try {
      const next = [];
      for (const [index, section] of sections.entries()) {
        let photoId = section.photo?.id || null;
        if (section.file) {
          setProgress(`사진 ${index + 1} 등록 중…`);
          const photo = await ccParticipationApi.uploadPhoto(section.file);
          uploaded.push(photo.id); photoId = photo.id;
        }
        next.push({ title: section.title, description: section.description, photoId });
      }
      setProgress('자료 저장 중…');
      const result = await ccParticipationApi.save({ introduction, introductionColor, bottomText, version: document.version, sections: next });
      onDirtyChange(false); onSaved(result);
    } catch (failure) {
      await Promise.allSettled(uploaded.map((id) => ccParticipationApi.discardPhoto(id)));
      setError(failure instanceof Error ? failure.message : '저장하지 못했습니다. 다시 시도해주세요.');
    } finally { setBusy(false); onBusyChange(false); setProgress(''); }
  };

  return <form onSubmit={save} aria-label="CC 참여 자료 등록·수정" className="space-y-5">
    <p className="rounded-lg bg-blue-50 p-3 text-sm leading-6 text-[#173B57]">사진은 최대 5장까지 등록할 수 있습니다. 각 항목에는 사진과 설명을 함께 넣거나 글만 작성할 수 있습니다. 빈 항목은 표시되지 않습니다.</p>
    <fieldset disabled={busy || processing.size > 0} className="min-w-0 space-y-5 disabled:opacity-60">
      <div className="space-y-2">
        <label className="block text-sm font-bold text-[#173B57]">상단 안내 문구<textarea aria-label="상단 안내 문구" className={field} style={{ color: introductionColor }} rows={2} maxLength={2000} value={introduction} onChange={(event) => { setIntroduction(event.target.value); setDirty(true); }} /></label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm text-[#173B57]">글자 색<input type="color" aria-label="상단 안내문구 글자 색" value={introductionColor} onChange={(event) => { setIntroductionColor(event.target.value); setDirty(true); }} className="h-11 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" /></label>
          <span className="font-mono text-xs text-slate-500">{introductionColor}</span>
          <button type="button" onClick={() => { setIntroductionColor(CC_INTRODUCTION_DEFAULT_COLOR); setDirty(true); }} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-600">기본색</button>
        </div>
      </div>
      {sections.map((section, index) => <section key={section.id} aria-label={`자료 ${index + 1} 편집`} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-extrabold text-[#173B57]">자료 {index + 1}</h3><button type="button" onClick={() => changeSection(index, { title: '', description: '', photo: null, file: null, inputKey: section.inputKey + 1 })} className="min-h-11 px-2 text-xs text-red-700">항목 비우기</button></div>
        <label className="block text-sm">제목<input className={field} maxLength={120} value={section.title} onChange={(event) => changeSection(index, { title: event.target.value })} /></label>
        {section.photo ? <div><img src={apiResourceUrl(section.photo.url)} alt={section.photo.alt} className="max-h-48 max-w-full rounded-lg object-contain" /><button type="button" className="mt-1 min-h-11 text-xs text-red-700" onClick={() => changeSection(index, { photo: null, file: null, inputKey: section.inputKey + 1 })}>사진 삭제</button></div> : null}
        <ManualPhotoInput key={`${section.id}-${section.inputKey}`} label={section.photo ? '사진 교체' : '사진 선택 (선택사항)'} maxSide={2000} maxBytes={CC_PHOTO_MAX_BYTES} disabled={busy} onReady={(file) => changeSection(index, { file })} onProcessingChange={(working) => setProcessing((current) => { const next = new Set(current); if (working) next.add(index); else next.delete(index); return next; })} />
        <label className="block text-sm">사진 설명 / 텍스트<textarea aria-label="사진 설명 / 텍스트" className={field} rows={4} maxLength={10000} value={section.description} onChange={(event) => changeSection(index, { description: event.target.value })} placeholder="사진에 대한 설명을 입력하세요. 사진 없이 글만 작성해도 됩니다." /></label>
      </section>)}
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 sm:p-4"><label className="block text-sm font-bold text-[#173B57]">하단 공통 텍스트<textarea aria-label="하단 공통 텍스트" className={field} rows={7} maxLength={20000} value={bottomText} onChange={(event) => { setBottomText(event.target.value); setDirty(true); }} placeholder="사진·설명 항목의 맨 아래에 별도로 표시할 안내 내용을 입력하세요." /></label><p className="mt-2 text-xs text-slate-500">사진 없이 이 텍스트만 등록할 수도 있습니다. 줄바꿈은 그대로 표시됩니다.</p></section>
    </fieldset>
    {error ? <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {busy ? <p role="status" className="text-sm text-blue-700">{progress}</p> : null}
    <div className="sticky -bottom-4 flex justify-end gap-2 border-t border-slate-200 bg-white py-3 sm:-bottom-5"><button type="button" disabled={busy || processing.size > 0} onClick={onCancel} className="min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50">취소</button><button type="submit" disabled={busy || processing.size > 0} className="flex min-h-11 items-center gap-2 rounded-lg bg-[#2878B5] px-4 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{busy ? '저장 중…' : processing.size ? '사진 처리 중…' : '전체 저장'}</button></div>
  </form>;
};
