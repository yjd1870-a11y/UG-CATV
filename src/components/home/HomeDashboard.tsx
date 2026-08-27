import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Boxes, ChevronDown, ClipboardList, Pencil, Plus, Radio, Save, Trash2, X, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { noticesApi } from '../../features/notices/api';
import { HomeNotice } from '../../types';
import { CatvManpowerStatusCard } from './CatvManpowerStatusCard';

const seoulDateParts = (date: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date).map((part) => [part.type, part.value])
);

const seoulDateKey = (date: Date) => {
  const parts = seoulDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const seoulDateLabel = (date: Date) => {
  const parts = seoulDateParts(date);
  return `${parts.year}.${parts.month}.${parts.day} (${parts.weekday})`;
};

export const HomeDashboard: React.FC = () => {
  const {
    currentUser,
    cells,
    transfers,
    dailyRecords,
    materialUsage,
    recentCells,
    navigateTo,
    selectCell,
    showToast,
  } = useApp();

  const [now, setNow] = useState(() => new Date());
  const [notices, setNotices] = useState<HomeNotice[]>([]);
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [noticeDraft, setNoticeDraft] = useState({ title: '', content: '' });
  const [newNoticeOpen, setNewNoticeOpen] = useState(false);
  const canManageNotices = currentUser?.role === 'admin' || currentUser?.role === 'team_leader';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void noticesApi.list()
      .then(setNotices)
      .catch((error) => showToast(error instanceof Error ? error.message : '전달사항을 불러오지 못했습니다.', 'error'));
  }, [showToast]);

  const startNoticeEdit = (notice: HomeNotice) => {
    setEditingNoticeId(notice.id);
    setExpandedNoticeId(notice.id);
    setNoticeDraft({ title: notice.title, content: notice.content });
  };

  const saveNotice = async (notice?: HomeNotice) => {
    if (!noticeDraft.title.trim() || !noticeDraft.content.trim()) {
      showToast('전달사항 제목과 내용을 입력해주세요.', 'warning');
      return;
    }
    try {
      if (notice) {
        const saved = await noticesApi.update(notice.id, { ...noticeDraft, sortOrder: notice.sortOrder });
        setNotices((previous) => previous.map((item) => item.id === saved.id ? saved : item));
        setEditingNoticeId(null);
        showToast('전달사항을 수정했습니다.', 'success');
      } else {
        const saved = await noticesApi.create(noticeDraft);
        setNotices((previous) => [...previous, saved]);
        setExpandedNoticeId(saved.id);
        setNewNoticeOpen(false);
        showToast('전달사항을 추가했습니다.', 'success');
      }
      setNoticeDraft({ title: '', content: '' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '전달사항을 저장하지 못했습니다.', 'error');
    }
  };

  const deleteNotice = async (notice: HomeNotice) => {
    if (!window.confirm(`“${notice.title}” 전달사항을 삭제하시겠습니까?`)) return;
    try {
      await noticesApi.remove(notice.id);
      setNotices((previous) => previous.filter((item) => item.id !== notice.id));
      if (expandedNoticeId === notice.id) setExpandedNoticeId(null);
      showToast('전달사항을 삭제했습니다.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '전달사항을 삭제하지 못했습니다.', 'error');
    }
  };

  const pendingTransfers = transfers.filter(
    (transfer) => transfer.status === '대기' || transfer.status === '작업중'
  );

  const todayStr = seoulDateKey(now);
  const todayUserRecord = dailyRecords.find(
    (record) => record.date.replace(/\./g, '-') === todayStr && record.workerName === (currentUser?.name || '김현장')
  );
  const todayTotalWorkCount = todayUserRecord
    ? Object.values(todayUserRecord.counts).reduce((total, count) => total + count, 0)
    : 0;

  const todayMaterials = materialUsage.filter((material) => material.workDate.replace(/\./g, '-').startsWith(todayStr));
  const todayMaterialCount = todayMaterials.reduce((total, material) => total + material.quantity, 0);

  return (
    <div id="home-dashboard-view" className="space-y-5 pb-24 text-[#1F2937] sm:pb-8">
      {/* 1. 현장 유지보수 전달사항 & 안전수칙 */}
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 font-bold text-[#2878B5]">
              <Zap className="h-4 w-4" />
            </div>
            <h2 className="text-base font-bold text-[#173B57]">현장 유지보수 전달사항 &amp; 안전수칙</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 text-[11px] font-medium text-[#6B7280] sm:inline">전송망사업팀</span>
            {canManageNotices ? <button type="button" onClick={() => { setNewNoticeOpen((open) => !open); setNoticeDraft({ title: '', content: '' }); }} className="flex h-8 items-center gap-1 rounded-lg bg-[#2878B5] px-2.5 text-[11px] font-bold text-white"><Plus className="h-3.5 w-3.5" />추가</button> : null}
          </div>
        </div>
        {newNoticeOpen ? <div className="mb-2.5 space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3"><input aria-label="새 전달사항 제목" value={noticeDraft.title} onChange={(event) => setNoticeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="전달사항 제목" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold" /><textarea aria-label="새 전달사항 내용" value={noticeDraft.content} onChange={(event) => setNoticeDraft((current) => ({ ...current, content: event.target.value }))} placeholder="상세 내용을 입력하세요." rows={3} className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setNewNoticeOpen(false)} className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold"><X className="h-3.5 w-3.5" />취소</button><button type="button" onClick={() => void saveNotice()} className="flex h-8 items-center gap-1 rounded-lg bg-[#F28C28] px-3 text-[11px] font-bold text-white"><Save className="h-3.5 w-3.5" />저장</button></div></div> : null}
        <div className="space-y-2 text-xs text-[#1F2937]">
          {notices.length ? notices.map((notice, index) => {
            const expanded = expandedNoticeId === notice.id;
            const editing = editingNoticeId === notice.id;
            return <article key={notice.id} className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedNoticeId(expanded ? null : notice.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="font-black text-[#2878B5]">{index + 1}.</span><span className="truncate font-bold text-[#173B57]">{notice.title}</span><ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
                {canManageNotices ? <div className="flex shrink-0 gap-1"><button type="button" aria-label={`${notice.title} 수정`} onClick={() => startNoticeEdit(notice)} className="rounded-lg p-1.5 text-[#2878B5] hover:bg-blue-100"><Pencil className="h-3.5 w-3.5" /></button><button type="button" aria-label={`${notice.title} 삭제`} onClick={() => void deleteNotice(notice)} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button></div> : null}
              </div>
              {expanded ? <div className="border-t border-slate-200 bg-white p-3">{editing ? <div className="space-y-2"><input aria-label="전달사항 제목 수정" value={noticeDraft.title} onChange={(event) => setNoticeDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 font-bold" /><textarea aria-label="전달사항 내용 수정" value={noticeDraft.content} onChange={(event) => setNoticeDraft((current) => ({ ...current, content: event.target.value }))} rows={3} className="w-full resize-none rounded-lg border border-slate-200 p-3" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingNoticeId(null)} className="h-8 rounded-lg border border-slate-200 px-3 text-[11px] font-bold">취소</button><button type="button" onClick={() => void saveNotice(notice)} className="flex h-8 items-center gap-1 rounded-lg bg-[#F28C28] px-3 text-[11px] font-bold text-white"><Save className="h-3.5 w-3.5" />저장</button></div></div> : <p className="whitespace-pre-wrap leading-5 text-slate-600">{notice.content}</p>}</div> : null}
            </article>;
          }) : <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-slate-400">등록된 전달사항이 없습니다.</div>}
        </div>
      </section>

      {/* 2. 주요 업무 바로가기 */}
      <section aria-label="주요 업무 바로가기" className="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          id="home-menu-cell"
          type="button"
          onClick={() => navigateTo('cell_list')}
          className="home-action-card home-action-card--blue group"
        >
          <span className="home-action-card__wave" aria-hidden="true" />
          <div className="home-action-card__icon">
            <Radio className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2.4} />
          </div>
          <span className="home-action-card__title">CELL 조회</span>
          <p className="home-action-card__description">전송망 정보 확인</p>
        </button>

        <button
          id="home-menu-transfer"
          type="button"
          onClick={() => navigateTo('transfer_list')}
          className="home-action-card home-action-card--orange group"
        >
          <span className="home-action-card__wave" aria-hidden="true" />
          <div className="home-action-card__icon">
            <ArrowRightLeft className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2.4} />
          </div>
          <span className="home-action-card__title">업무이관</span>
          <p className="home-action-card__description">점검 및 이관 확인</p>
          {pendingTransfers.length > 0 ? (
            <span className="home-action-card__badge">
              {pendingTransfers.length}건
            </span>
          ) : null}
        </button>

        <button
          id="home-menu-daily"
          type="button"
          onClick={() => navigateTo('daily_work')}
          className="home-action-card home-action-card--green group"
        >
          <span className="home-action-card__wave" aria-hidden="true" />
          <div className="home-action-card__icon">
            <ClipboardList className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2.4} />
          </div>
          <span className="home-action-card__title">일일업무</span>
          <p className="home-action-card__description">오늘 작업 건수 등록</p>
        </button>

        <button
          id="home-menu-material"
          type="button"
          onClick={() => navigateTo('material_list')}
          className="home-action-card home-action-card--purple group"
        >
          <span className="home-action-card__wave" aria-hidden="true" />
          <div className="home-action-card__icon">
            <Boxes className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={2.4} />
          </div>
          <span className="home-action-card__title">자재사용</span>
          <p className="home-action-card__description">현장 사용 자재 등록</p>
        </button>
      </section>

      {/* 3. 오늘의 업무 현황 */}
      <section className="flex flex-col justify-between rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#173B57]">오늘의 업무 현황</h2>
          <span className="text-xs font-medium text-[#6B7280]">{seoulDateLabel(now)}</span>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-3 sm:gap-4">
          <button
            onClick={() => navigateTo('daily_work')}
            className="flex min-h-28 cursor-pointer flex-col justify-between rounded-xl border border-[#E5E7EB]/70 bg-[#F9FAFB] p-3.5 text-left transition hover:bg-blue-50/40 sm:p-4"
          >
            <span className="text-xs font-semibold text-[#6B7280]">오늘 작업 업무</span>
            <span className="my-1 flex items-baseline gap-1">
              <strong className="text-2xl font-black text-[#173B57] sm:text-3xl">
                {todayTotalWorkCount}
              </strong>
              <span className="text-xs font-medium text-[#9CA3AF]">건</span>
            </span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <span className="block h-full w-[70%] bg-[#2878B5]" />
            </span>
          </button>

          <button
            onClick={() => navigateTo('transfer_list')}
            className="flex min-h-28 cursor-pointer flex-col justify-between rounded-xl border border-[#E5E7EB]/70 bg-[#F9FAFB] p-3.5 text-left transition hover:bg-orange-50/40 sm:p-4"
          >
            <span className="text-xs font-semibold text-[#6B7280]">미처리 이관</span>
            <span className="my-1 flex items-baseline gap-1">
              <strong className="text-2xl font-black text-[#F28C28] sm:text-3xl">
                {pendingTransfers.length < 10 ? `0${pendingTransfers.length}` : pendingTransfers.length}
              </strong>
              <span className="text-xs font-medium text-[#9CA3AF]">건</span>
            </span>
            <span className="w-fit rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-[#F28C28]">
              긴급포함
            </span>
          </button>

          <button
            onClick={() => {
              const targetName = recentCells[0] || 'SUJI-021-B';
              const target = cells.find((cell) => cell.cellName === targetName);
              if (target) selectCell(target.id);
              else navigateTo('cell_list');
            }}
            className="flex min-h-28 cursor-pointer flex-col justify-between rounded-xl border border-[#E5E7EB]/70 bg-[#F9FAFB] p-3.5 text-left transition hover:bg-slate-100/70 sm:p-4"
          >
            <span className="text-xs font-semibold text-[#6B7280]">최근 조회 CELL</span>
            <strong className="mt-1 truncate text-sm font-black text-[#173B57] sm:text-base">
              {recentCells[0] || 'SUJI-021-B'}
            </strong>
            <span className="text-[10px] text-gray-400">15분 전 조회</span>
          </button>

          <button
            onClick={() => navigateTo('material_list')}
            className="flex min-h-28 cursor-pointer flex-col justify-between rounded-xl border border-[#E5E7EB]/70 bg-[#F9FAFB] p-3.5 text-left transition hover:bg-green-50/40 sm:p-4"
          >
            <span className="text-xs font-semibold text-[#6B7280]">금일 자재사용</span>
            <span className="my-1 flex items-baseline gap-1">
              <strong className="text-2xl font-black text-green-600 sm:text-3xl">
                {todayMaterialCount > 0
                  ? todayMaterialCount < 10
                    ? `0${todayMaterialCount}`
                    : todayMaterialCount
                  : '00'}
              </strong>
              <span className="text-xs font-medium text-[#9CA3AF]">종</span>
            </span>
            <span className="text-[10px] text-gray-400">Connector 외 4</span>
          </button>
        </div>
      </section>

      {/* 4. CATV 인력현황 */}
      <CatvManpowerStatusCard />
    </div>
  );
};
