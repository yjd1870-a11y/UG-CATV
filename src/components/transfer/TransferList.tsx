import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Calendar,
  ChevronRight,
  Filter,
  Layers,
  MapPin,
  Plus,
  Radio,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TransferStatus } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

export const TransferList: React.FC = () => {
  const { transfers, selectTransfer, addTransferTicket, currentUser } = useApp();
  const [selectedFilter, setSelectedFilter] = useState<string>('전체');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [showNewModal, setShowNewModal] = useState(false);

  // New ticket form state
  const [serviceNo, setServiceNo] = useState(`SVC-2026-${Date.now().toString().slice(-4)}`);
  const [cellName, setCellName] = useState('OSAN-001');
  const [mediaType, setMediaType] = useState<'HFC' | 'FTTH' | 'RF' | '광복합'>('HFC');
  const [serviceTech, setServiceTech] = useState('DOCSIS 3.1 / CATV 디지털');
  const [location, setLocation] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [preActionNotes, setPreActionNotes] = useState('');
  const [requestDetails, setRequestDetails] = useState('');

  const filterTabs = ['전체', '대기', '작업중', '업무이관', '완료'];

  const filteredTransfers = transfers.filter((item) => {
    const matchStatus =
      selectedFilter === '전체' || item.status === selectedFilter;

    const query = searchKeyword.trim().toLowerCase();
    const matchQuery =
      !query ||
      item.serviceNo.toLowerCase().includes(query) ||
      item.cellName.toLowerCase().includes(query) ||
      item.transferReason.toLowerCase().includes(query) ||
      item.contractor.toLowerCase().includes(query) ||
      item.location.toLowerCase().includes(query);

    return matchStatus && matchQuery;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferReason.trim()) return;

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    addTransferTicket({
      serviceNo: serviceNo.trim() || `SVC-2026-${Date.now().toString().slice(-4)}`,
      contractor: `${currentUser?.company || '유지텔레컴'} (${currentUser?.team || '전송1팀'})`,
      requestDate: timeStr,
      status: '대기',
      mediaType,
      serviceTech,
      cellName,
      location: location.trim() || `${cellName} 관할 구역`,
      transferReason: transferReason.trim(),
      preActionNotes: preActionNotes.trim() || '현장 사전 측정 진행',
      requestDetails: requestDetails.trim() || '전송선로 정비 및 조치 요망',
      requesterName: currentUser?.name || '김현장',
    });

    setShowNewModal(false);
    setTransferReason('');
    setPreActionNotes('');
    setRequestDetails('');
    setLocation('');
  };

  return (
    <div id="transfer-list-view" className="space-y-4 pb-20 sm:pb-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-[#F28C28]" />
            <h1 className="text-xl font-extrabold text-[#173B57]">
              업무이관 관리
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            고객센터 및 운용본부 점검요청 · 이관업무 확인 및 현장 조치
          </p>
        </div>

        {currentUser?.role === 'team_leader' || currentUser?.role === 'admin' ? (
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs font-bold rounded-xl shadow-xs transition self-start sm:self-auto cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ 업무이관 등록</span>
          </button>
        ) : null}
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-[#E5E7EB] space-y-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {filterTabs.map((tab) => {
            const count =
              tab === '전체'
                ? transfers.length
                : transfers.filter((t) => t.status === tab).length;

            return (
              <button
                key={tab}
                onClick={() => setSelectedFilter(tab)}
                className={`px-3.5 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                  selectedFilter === tab
                    ? 'bg-[#173B57] text-white shadow-xs'
                    : 'bg-[#F9FAFB] border border-[#E5E7EB] text-[#6B7280] hover:bg-slate-100 hover:text-[#173B57]'
                }`}
              >
                <span>{tab}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    selectedFilter === tab
                      ? 'bg-white text-[#173B57]'
                      : 'bg-[#E5E7EB] text-[#1F2937]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="서비스번호, CELL명, 이관사유, 위치 검색"
            className="w-full h-11 pl-10 pr-10 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl text-xs font-medium focus:bg-white focus:border-[#2878B5] outline-none transition text-[#1F2937] placeholder-[#9CA3AF]"
          />
          {searchKeyword && (
            <button
              onClick={() => setSearchKeyword('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1F2937] text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Transfer Cards List */}
      <div className="space-y-3">
        {filteredTransfers.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#E5E7EB]">
            <ArrowRightLeft className="w-10 h-10 mx-auto text-[#9CA3AF] mb-2" />
            <div className="text-sm font-bold text-[#173B57]">
              해당 조건의 업무이관 내역이 없습니다.
            </div>
            <div className="text-xs text-[#6B7280] mt-1">
              필터를 변경하거나 검색어를 초기화해보세요.
            </div>
          </div>
        ) : (
          filteredTransfers.map((item) => (
            <div
              key={item.id}
              onClick={() => selectTransfer(item.id)}
              className="bg-white hover:bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm hover:shadow-md transition cursor-pointer"
            >
              {/* Header Line */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm sm:text-base text-[#173B57]">
                    {item.serviceNo}
                  </span>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <span className="text-[11px] font-bold bg-blue-50 text-[#2878B5] px-2.5 py-0.5 rounded-lg">
                  {item.mediaType}
                </span>
              </div>

              {/* Transfer Reason (Main) */}
              <div className="font-bold text-xs sm:text-sm text-[#1F2937] mb-2 leading-snug line-clamp-2">
                {item.transferReason}
              </div>

              {/* Key Meta Grid */}
              <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-[#6B7280]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#9CA3AF] font-medium">CELL:</span>
                  <strong className="text-[#173B57]">{item.cellName}</strong>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[#9CA3AF] font-medium">요청업체:</span>
                  <span className="text-[#1F2937] truncate">{item.contractor}</span>
                </div>
                <div className="flex items-center gap-1.5 col-span-1 sm:col-span-2">
                  <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                  <span className="truncate text-[#1F2937]">{item.location}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-2.5 pt-2 border-t border-[#E5E7EB] flex items-center justify-between text-[11px] text-[#6B7280]">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-[#9CA3AF]" />
                  <span>요청일: {item.requestDate}</span>
                </div>
                <span className="text-[#2878B5] font-bold flex items-center">
                  상세보기 <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* New Transfer Registration Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-extrabold text-base text-[#173B57] flex items-center gap-1.5">
                <ArrowRightLeft className="w-5 h-5 text-[#F28C28]" />
                <span>업무이관 신규 등록</span>
              </h3>
              <button
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    서비스 관리번호 *
                  </label>
                  <input
                    type="text"
                    value={serviceNo}
                    onChange={(e) => setServiceNo(e.target.value)}
                    required
                    className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    CELL명 *
                  </label>
                  <select
                    value={cellName}
                    onChange={(e) => setCellName(e.target.value)}
                    className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                  >
                    <option value="OSAN-001">OSAN-001 (오산 수청동)</option>
                    <option value="SUJI-021">SUJI-021 (수지 풍덕천동)</option>
                    <option value="PYEONGTAEK-015">PYEONGTAEK-015 (평택 비전동)</option>
                    <option value="SONGTAN-008">SONGTAN-008 (송탄 신장동)</option>
                    <option value="ANSEONG-012">ANSEONG-012 (안성 당왕동)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    매체구분 *
                  </label>
                  <select
                    value={mediaType}
                    onChange={(e) =>
                      setMediaType(e.target.value as 'HFC' | 'FTTH' | 'RF' | '광복합')
                    }
                    className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                  >
                    <option value="HFC">HFC (동축/광 혼용)</option>
                    <option value="FTTH">FTTH (광직결)</option>
                    <option value="RF">RF (동축전용)</option>
                    <option value="광복합">광복합</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    서비스 기술방식
                  </label>
                  <input
                    type="text"
                    value={serviceTech}
                    onChange={(e) => setServiceTech(e.target.value)}
                    className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  현장 세부 위치
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="예: 오산시 수청동 618-3 102동 앞 전주 #34-2"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  이관 사유 *
                </label>
                <input
                  type="text"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="예: 인입케이블 불량 및 TAP 노이즈 유입 확인"
                  required
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  사전조치 내용
                </label>
                <textarea
                  rows={2}
                  value={preActionNotes}
                  onChange={(e) => setPreActionNotes(e.target.value)}
                  placeholder="세대 모뎀 수신레벨 측정값, 옥외 전주 점검 내용 등"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none resize-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  점검요청 내용
                </label>
                <textarea
                  rows={2}
                  value={requestDetails}
                  onChange={(e) => setRequestDetails(e.target.value)}
                  placeholder="상위 TBA 증폭기 레벨 조정, TAP 교체 등 구체적 요청 사항"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none resize-none"
                />
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#F28C28] hover:bg-[#d97718] text-white font-bold rounded-xl shadow-xs"
                >
                  등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
