import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  History,
  Layers,
  MapPin,
  MessageSquare,
  Radio,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TransferStatus } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

export const TransferDetail: React.FC = () => {
  const {
    transfers,
    selectedTransferId,
    navigateTo,
    selectCell,
    updateTransferStatus,
    currentUser,
  } = useApp();

  const [statusComment, setStatusComment] = useState('');
  const [showStatusModal, setShowStatusModal] = useState<TransferStatus | null>(null);

  const transfer =
    transfers.find((t) => t.id === selectedTransferId) || transfers[0];

  if (!transfer) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <div className="text-sm font-bold text-slate-700">
          선택된 업무이관 건을 찾을 수 없습니다.
        </div>
        <button
          onClick={() => navigateTo('transfer_list')}
          className="mt-3 px-4 py-2 bg-[#2878B5] text-white text-xs font-bold rounded-xl"
        >
          목록으로 이동
        </button>
      </div>
    );
  }

  const handleStatusChange = (nextStatus: TransferStatus) => {
    updateTransferStatus(transfer.id, nextStatus, statusComment);
    setStatusComment('');
    setShowStatusModal(null);
  };

  const statusSteps: TransferStatus[] = ['대기', '작업중', '업무이관', '완료'];

  return (
    <div id="transfer-detail-view" className="space-y-4 pb-24 sm:pb-8 text-[#1F2937]">
      {/* Top Back Nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateTo('transfer_list')}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#173B57] hover:text-[#2878B5] bg-white px-3.5 py-2 rounded-xl border border-[#E5E7EB] shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>업무이관 목록</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => selectCell(transfer.cellName)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-[#2878B5] text-xs font-bold rounded-xl border border-blue-200 transition cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>관련 CELL ({transfer.cellName}) 조회</span>
          </button>
        </div>
      </div>

      {/* Main Header Banner */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-[#173B57] tracking-tight">
                {transfer.serviceNo}
              </h1>
              <StatusBadge status={transfer.status} size="md" />
            </div>
            <p className="text-xs text-[#6B7280] mt-1">
              요청일자: <strong className="text-[#1F2937]">{transfer.requestDate}</strong> · 매체: {transfer.mediaType}
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs font-bold bg-[#F9FAFB] border border-[#E5E7EB] text-[#1F2937] px-3 py-1 rounded-lg">
              {transfer.serviceTech}
            </span>
          </div>
        </div>

        {/* Status Transition Flow Bar */}
        <div>
          <div className="text-xs font-extrabold text-[#173B57] mb-2 flex items-center justify-between">
            <span>현장 처리 상태 단계</span>
            <span className="text-[11px] font-normal text-[#9CA3AF]">
              클릭하여 상태 변경
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {statusSteps.map((step, idx) => {
              const isCurrent = transfer.status === step;
              const isPassed =
                statusSteps.indexOf(transfer.status) > idx;

              return (
                <button
                  key={step}
                  onClick={() => setShowStatusModal(step)}
                  className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center min-h-[56px] ${
                    isCurrent
                      ? 'bg-[#173B57] text-white border-[#173B57] shadow-sm font-bold scale-[1.02]'
                      : isPassed
                      ? 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6] font-semibold'
                      : 'bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB] hover:bg-blue-50 hover:border-blue-300 font-medium'
                  }`}
                >
                  <div className="text-[11px] flex items-center gap-1">
                    {isPassed && <CheckCircle2 className="w-3 h-3 text-[#137333]" />}
                    <span>{step}</span>
                  </div>
                  {isCurrent && (
                    <span className="text-[9px] text-amber-300 font-bold mt-0.5">
                      (현재상태)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 1: 점검요청정보 */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm">
        <h2 className="text-sm font-extrabold text-[#173B57] mb-3 flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-[#2878B5]" />
          <span>점검 요청 정보</span>
        </h2>

        <div className="divide-y divide-[#E5E7EB] text-xs">
          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">점검작업업체</span>
            <span className="col-span-2 sm:col-span-3 font-semibold text-[#1F2937]">
              {transfer.contractor}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">점검요청일</span>
            <span className="col-span-2 sm:col-span-3 font-semibold text-[#1F2937]">
              {transfer.requestDate}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">서비스 관리번호</span>
            <span className="col-span-2 sm:col-span-3 font-mono font-bold text-[#173B57]">
              {transfer.serviceNo}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">서비스 기술방식</span>
            <span className="col-span-2 sm:col-span-3 font-semibold text-[#1F2937]">
              {transfer.serviceTech}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">매체구분</span>
            <span className="col-span-2 sm:col-span-3">
              <span className="font-bold text-[#2878B5] bg-blue-50 px-2 py-0.5 rounded">
                {transfer.mediaType}
              </span>
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">관할 CELL</span>
            <span className="col-span-2 sm:col-span-3 font-bold text-[#173B57]">
              {transfer.cellName}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
            <span className="font-bold text-[#6B7280]">현장 위치</span>
            <span className="col-span-2 sm:col-span-3 font-medium text-[#1F2937]">
              {transfer.location}
            </span>
          </div>

          <div className="py-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/60">
            <span className="font-bold text-amber-900">이관 사유</span>
            <span className="col-span-2 sm:col-span-3 font-bold text-amber-950">
              {transfer.transferReason}
            </span>
          </div>
        </div>
      </div>

      {/* Section 2: 작업정보 (사전조치내용 / 점검요청내용) */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-[#F28C28]" />
          <span>현장 작업 정보</span>
        </h2>

        {/* 사전조치내용 */}
        <div className="p-3.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
          <div className="text-xs font-bold text-[#1F2937] mb-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#2878B5]" />
            <span>사전조치 내용</span>
          </div>
          <p className="text-xs text-[#6B7280] font-medium leading-relaxed">
            {transfer.preActionNotes || '사전 조치 내역 없음'}
          </p>
        </div>

        {/* 점검요청내용 */}
        <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-200/80">
          <div className="text-xs font-bold text-[#173B57] mb-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#F28C28]" />
            <span>점검요청 내용 (현장 조치 사항)</span>
          </div>
          <p className="text-xs text-[#1F2937] font-medium leading-relaxed">
            {transfer.requestDetails || '점검 요청 내용 없음'}
          </p>
        </div>
      </div>

      {/* Section 3: 이관 처리 이력 로그 */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5">
          <History className="w-4 h-4 text-[#2878B5]" />
          <span>상태 변경 및 처리 이력 ({transfer.logs?.length || 0}건)</span>
        </h2>

        <div className="space-y-2">
          {transfer.logs && transfer.logs.length > 0 ? (
            transfer.logs.map((log, index) => (
              <div
                key={index}
                className="p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={log.toStatus} size="sm" />
                    <span className="font-bold text-[#1F2937]">{log.author}</span>
                  </div>
                  <span className="text-[11px] text-[#9CA3AF] font-mono">
                    {log.timestamp}
                  </span>
                </div>
                <p className="text-[#6B7280] font-medium pl-1">{log.comment}</p>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-xs text-[#9CA3AF]">
              이력 로그가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Sticky Action Bar for Fast Status Update on Mobile */}
      <div className="sticky bottom-20 sm:bottom-4 z-20 bg-white/95 backdrop-blur-md p-3.5 rounded-2xl border border-[#E5E7EB] shadow-xl flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="text-[#6B7280]">현재 상태:</span>{' '}
          <strong className="text-[#173B57]">{transfer.status}</strong>
        </div>

        <div className="flex gap-2">
          {transfer.status !== '작업중' && (
            <button
              onClick={() => setShowStatusModal('작업중')}
              className="px-3.5 py-2 bg-[#2878B5] hover:bg-[#1f6396] text-white text-xs font-bold rounded-xl transition cursor-pointer"
            >
              작업 시작
            </button>
          )}
          {transfer.status !== '완료' && (
            <button
              onClick={() => setShowStatusModal('완료')}
              className="px-4 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
            >
              작업 완료
            </button>
          )}
        </div>
      </div>

      {/* Status Change Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB] mb-4">
              <h3 className="font-extrabold text-base text-[#173B57] flex items-center gap-1.5">
                <ArrowRightLeft className="w-5 h-5 text-[#F28C28]" />
                <span>업무 상태 변경: [{showStatusModal}]</span>
              </h3>
              <button
                onClick={() => setShowStatusModal(null)}
                className="p-1 text-[#9CA3AF] hover:text-[#1F2937]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                <div className="text-[#6B7280] font-medium">
                  {transfer.serviceNo} 상태를{' '}
                  <strong className="text-[#173B57]">[{transfer.status}]</strong>에서{' '}
                  <strong className="text-[#2878B5]">[{showStatusModal}]</strong>(으)로
                  변경합니다.
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#1F2937] mb-1">
                  작업 내용 / 사유 코멘트 (선택)
                </label>
                <textarea
                  rows={3}
                  value={statusComment}
                  onChange={(e) => setStatusComment(e.target.value)}
                  placeholder="예: 현장 점검 완료 후 TBA 레벨 +38dBmV 정상 조정함"
                  className="w-full p-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none resize-none text-[#1F2937]"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(null)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-[#1F2937] font-bold rounded-xl cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange(showStatusModal)}
                  className="flex-1 h-11 bg-[#F28C28] hover:bg-[#d97718] text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  상태 변경 확정
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
