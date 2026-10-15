import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Plus, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { manualApi } from '../../features/manual/api';
import type { ManualCategory, ManualModel } from '../../features/manual/types';
import { ManualImage } from './ManualMedia';
import { ManualDetail } from './ManualDetail';

const field = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white p-3';
const equipmentBadgeColors: Record<string, string> = {
  'rf-meter': 'bg-blue-50 text-blue-700', otdr: 'bg-teal-50 text-teal-700',
  'fusion-splicer': 'bg-violet-50 text-violet-700', 'optical-meter': 'bg-orange-50 text-orange-700',
};
export const ManualView: React.FC = () => {
  const { navigateTo } = useApp();
  const detailId = /^\/manual\/models\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
  const [categories, setCategories] = useState<ManualCategory[]>([]); const [models, setModels] = useState<ManualModel[]>([]);
  const [categoryId, setCategoryId] = useState(() => new URLSearchParams(window.location.search).get('category') || '');
  const [query, setQuery] = useState(''); const [canManage, setCanManage] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [reload, setReload] = useState(0); const [editing, setEditing] = useState<'category' | 'model' | null>(null);
  const [popupId, setPopupId] = useState<string | null>(null); const popup = useRef<HTMLDialogElement>(null);
  const closePopup = () => { setPopupId(null); setReload((value) => value + 1); };
  useEffect(() => {
    if (!popupId) return;
    const dialog = popup.current; dialog?.showModal();
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, [popupId]);
  const [name, setName] = useState(''); const [manufacturer, setManufacturer] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [formError, setFormError] = useState('');
  const category = categories.find((c) => c.id === categoryId);
  useEffect(() => {
    if (detailId) return;
    const controller = new AbortController(); setLoading(true); setError(''); setModels([]);
    Promise.all([manualApi.categories(controller.signal), categoryId ? manualApi.models(categoryId, controller.signal) : Promise.resolve([])]).then(([result, list]) => {
      if (controller.signal.aborted) return;
      setCategories(result.items); setCanManage(result.canManage); setModels(list); setLoading(false);
    }).catch((e) => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.'); setLoading(false); } });
    return () => controller.abort();
  }, [categoryId, reload, detailId]);
  // A file chooser returns window focus before its change event. Reloading here unmounted
  // the photo input and discarded the selected file, so refresh only after explicit changes.
  useEffect(() => {
    const pop = () => { setCategoryId(new URLSearchParams(window.location.search).get('category') || ''); setQuery(''); setEditing(null); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  const select = (id: string) => {
    setCategoryId(id); setQuery(''); setEditing(null); setError('');
    window.history.pushState({ catvApp: true, view: 'manual' }, '', id ? `/manual?category=${encodeURIComponent(id)}` : '/manual');
  };
  const openForm = (kind: 'category' | 'model') => { setEditing(kind); setName(''); setManufacturer(''); setDescription(''); setFormError(''); };
  const register = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setFormError('');
    try { if (editing === 'category') await manualApi.category(null, { name, description }); else await manualApi.model(null, { categoryId, name, manufacturer, description }); setEditing(null); setReload((n) => n + 1); }
    catch (e) { setFormError(e instanceof Error ? e.message : '등록하지 못했습니다.'); } finally { setBusy(false); }
  };
  const removeCategory = async () => {
    if (!category || !window.confirm(`‘${category.name}’ 장비 종류를 삭제할까요? 등록된 모델이 있으면 삭제할 수 없습니다.`)) return;
    setBusy(true);
    try { await manualApi.deleteCategory(category.id); select(''); setReload((n) => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했습니다.'); } finally { setBusy(false); }
  };
  if (detailId) return <ManualDetail key={detailId} id={decodeURIComponent(detailId)} />;
  const normalized = query.trim().toLocaleLowerCase();
  const list = categoryId ? models.filter((m) => `${m.name} ${m.manufacturer}`.toLocaleLowerCase().includes(normalized)) : categories.filter((c) => c.name.toLocaleLowerCase().includes(normalized));
  return <section className="space-y-5" id="manual-view"><button onClick={() => categoryId ? select('') : navigateTo('home')} className="flex min-h-11 items-center gap-2 text-sm font-bold text-[#173B57]"><ArrowLeft size={18} />{categoryId ? '장비 목록' : '홈으로'}</button>
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-3 text-xl font-extrabold text-[#173B57]"><BookOpen className="shrink-0 text-teal-600" />{category ? `${category.name} 모델 선택` : '현장 장비 매뉴얼'}</h1>{canManage && <button onClick={() => openForm(categoryId ? 'model' : 'category')} className="flex min-h-11 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-bold text-white"><Plus size={18} />{categoryId ? '모델 등록' : '장비 등록'}</button>}</div>
      <p className="mt-2 text-sm text-slate-500">{categoryId ? '장비의 모델명을 확인하고 선택하세요.' : '장비별 사용방법과 현장 노하우를 확인하세요. 장비를 선택하면 모델 목록으로 이동합니다.'}</p>
      {editing && <form onSubmit={register} className="mt-5 space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4"><h2 className="font-bold">{editing === 'category' ? '장비 종류 등록' : '모델 등록'}</h2><label className="block text-sm">{editing === 'category' ? '장비명' : '모델명'}<input className={`${field} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={editing === 'category' ? 80 : 100} /></label>
        {editing === 'model' && <label className="block text-sm">제조사<input className={`${field} mt-1`} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} maxLength={100} /></label>}<label className="block text-sm">짧은 설명<input className={`${field} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></label>{formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setEditing(null)} className="min-h-11 rounded-lg border bg-white px-4">취소</button><button disabled={busy} className="min-h-11 rounded-lg bg-teal-600 px-5 font-bold text-white">{busy ? '저장 중...' : '등록'}</button></div></form>}
      <label className="relative mt-5 block"><span className="sr-only">{categoryId ? '모델명 검색' : '장비명 검색'}</span><Search className="absolute left-3 top-3 text-slate-400" size={20} /><input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} placeholder={categoryId ? '모델명 검색' : '장비명 검색'} className={`${field} pl-10`} /></label>
      {error && <div role="alert" className="mt-4 text-sm text-red-700">{error}<button onClick={() => setReload((n) => n + 1)} className="ml-3 min-h-11 underline">다시 불러오기</button></div>}
      {!categoryId && <p className="mt-5 border-t border-slate-100 pt-5 font-bold text-[#173B57]">전체 장비 <span className="ml-1 text-teal-600">{list.length}</span></p>}
      {loading ? <p role="status" className="p-8 text-center text-sm text-slate-500">목록을 불러오는 중...</p> : <div className={categoryId ? 'mt-4 space-y-3' : 'mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'}>{list.map((item) => {
        if (!categoryId) {
          const customIndex = categories.filter((c) => !equipmentBadgeColors[c.id]).findIndex((c) => c.id === item.id);
          // Use the full list so filtering never changes badge colors; generated hues
          // continue beyond a fixed palette as more equipment types are registered.
          const hue = (340 + Math.max(0, customIndex) * 137.508) % 360;
          const badgeStyle = equipmentBadgeColors[item.id] ? undefined : { backgroundColor: `hsl(${hue} 85% 95%)`, color: `hsl(${hue} 72% 30%)` };
          return <button key={item.id} onClick={() => select(item.id)} className="flex min-h-48 min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-500 hover:bg-teal-50/30 focus-visible:ring-2 focus-visible:ring-teal-600">
            <span style={badgeStyle} className={`self-start rounded-full px-3 py-1 text-sm font-bold ${equipmentBadgeColors[item.id] || ''}`}>{item.name}</span>
            <h2 className="mt-4 break-words text-lg font-extrabold text-[#173B57]">{item.name} 매뉴얼</h2>
            <p className="mb-5 mt-2 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{item.description || '장비 모델별 사용방법을 확인하세요.'}</p>
            <span className="mt-auto flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-50 text-sm font-bold text-[#173B57]">모델 선택<ChevronRight size={16} /></span>
          </button>;
        }
        const content = <><ManualImage key={item.imageUrl || item.id} url={item.imageUrl} label={item.name} className="h-20 w-20 shrink-0 rounded-lg sm:h-24 sm:w-24" /><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-extrabold text-[#173B57] [overflow-wrap:anywhere]">{item.name}</h2><p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{'manufacturer' in item ? item.manufacturer : item.description}</p>{'manufacturer' in item && item.description && <p className="mt-1 break-words text-sm text-slate-500">{item.description}</p>}</div><ChevronRight className="shrink-0 text-[#173B57]" size={20} /></>;
        const style = 'flex min-h-28 w-full items-center gap-4 rounded-xl border border-slate-200 p-3 text-left transition hover:border-teal-500 hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-600';
        return categoryId ? <button key={item.id} type="button" onClick={() => setPopupId(item.id)} className={style} aria-label={`${item.name} 사용방법 팝업 열기`}>{content}</button> : <button key={item.id} onClick={() => select(item.id)} className={style}>{content}</button>;
      })}{!list.length && <p role="status" className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">{query ? '검색 결과가 없습니다.' : categoryId ? '등록된 모델이 없습니다. 관리자에게 모델 등록을 요청해주세요.' : '등록된 장비가 없습니다.'}</p>}</div>}
      <p className="mt-4 text-sm text-slate-500">{categoryId ? `모델을 선택하면 팝업에서 사용방법을 확인합니다.${canManage ? ' 목록 썸네일은 사용방법 화면의 모델·첨부자료 관리에서 등록하세요.' : ''}` : '장비를 선택한 후 모델별 사용방법을 확인하세요.'}</p>{canManage && categoryId && <button disabled={busy} onClick={() => void removeCategory()} className="mt-3 min-h-11 text-sm text-red-700">이 장비 종류 삭제</button>}
    </div>
    {popupId && <dialog ref={popup} aria-label="장비 모델 사용방법" onCancel={(e) => { e.preventDefault(); closePopup(); }} className="fixed inset-0 m-auto max-h-[94dvh] w-[96vw] max-w-5xl overflow-y-auto rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/60"><ManualDetail key={popupId} id={popupId} onClose={closePopup} /></dialog>}
  </section>;
};
