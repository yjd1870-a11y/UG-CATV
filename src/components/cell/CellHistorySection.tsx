import React, { useState, useRef } from 'react';
import {
  Camera,
  Clock,
  Edit3,
  History,
  Image as ImageIcon,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CellInfo, CellWorkHistory } from '../../types';
import { createPhotoDataUrl } from '../../data/mockData';
import { InteractivePhotoViewer } from '../common/InteractivePhotoViewer';

interface CellHistorySectionProps {
  cell: CellInfo;
}

export const CellHistorySection: React.FC<CellHistorySectionProps> = ({ cell }) => {
  const {
    addCellHistory,
    updateCellHistory,
    deleteCellHistory,
    currentUser,
    showToast,
  } = useApp();
  const canWrite = currentUser?.role !== 'guest';

  // Create Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [histTitle, setHistTitle] = useState('');
  const [histWorker, setHistWorker] = useState(currentUser?.name || '김현장');
  const [histDate, setHistDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [histSummary, setHistSummary] = useState('');
  const [attachedPhotos, setAttachedPhotos] = useState<string[]>([]);

  // Detail View Modal State (클릭 시 작업이력 상세 보기)
  const [viewingHistory, setViewingHistory] = useState<CellWorkHistory | null>(null);

  // Edit Modal State (수정 모달)
  const [editingHistory, setEditingHistory] = useState<CellWorkHistory | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editWorker, setEditWorker] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editPhotos, setEditPhotos] = useState<string[]>([]);

  // Lightbox Preview for Large Photos
  const [preview, setPreview] = useState<{ photos: string[]; initialIndex: number; title: string } | null>(null);

  const addFileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // --- Add Modal Handlers ---
  const handleAddFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const remainingSlots = 3 - attachedPhotos.length;
    if (remainingSlots <= 0) {
      showToast('사진은 최대 3장까지만 등록 가능합니다.', 'warning');
      return;
    }

    const count = Math.min(fileList.length, remainingSlots);
    for (let i = 0; i < count; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        showToast('이미지 파일만 업로드할 수 있습니다.', 'warning');
        continue;
      }

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          setAttachedPhotos((prev) => {
            if (prev.length >= 3) return prev;
            return [...prev, result];
          });
        }
      };
      reader.readAsDataURL(file);
    }

    if (addFileInputRef.current) {
      addFileInputRef.current.value = '';
    }
  };

  const handleAddSamplePhoto = () => {
    if (attachedPhotos.length >= 3) {
      showToast('사진은 최대 3장까지만 등록 가능합니다.', 'warning');
      return;
    }

    const sampleThemes = [
      { title: `${cell.cellName} 선로 정비 사진`, subtitle: '단자함 점검 완료', color: '#173B57' },
      { title: `${cell.cellName} RF 레벨 측정`, subtitle: '출력 정상 확인 (+38dBmV)', color: '#2878B5' },
      { title: `${cell.cellName} 방호관 보강 작업`, subtitle: '안전 이격거리 확보', color: '#C25E00' },
    ];

    const currentSample = sampleThemes[attachedPhotos.length % sampleThemes.length];
    const sampleDataUrl = createPhotoDataUrl(
      currentSample.title,
      currentSample.subtitle,
      currentSample.color
    );

    setAttachedPhotos((prev) => [...prev, sampleDataUrl]);
    showToast('샘플 현장사진이 첨부되었습니다.', 'info');
  };

  const handleRemovePhoto = (index: number) => {
    setAttachedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!histTitle.trim()) {
      showToast('제목을 입력해주세요.', 'warning');
      return;
    }
    if (!histSummary.trim()) {
      showToast('작업내용을 입력해주세요.', 'warning');
      return;
    }

    addCellHistory(cell.id, {
      title: histTitle.trim(),
      type: histTitle.trim(),
      date: histDate || new Date().toISOString().slice(0, 10),
      worker: histWorker.trim() || currentUser?.name || '김현장',
      summary: histSummary.trim(),
      photos: attachedPhotos,
    });

    // Reset Form
    setHistTitle('');
    setHistSummary('');
    setAttachedPhotos([]);
    setShowAddModal(false);
  };

  // --- Edit Modal Handlers ---
  const handleOpenEdit = (hist: CellWorkHistory) => {
    setEditingHistory(hist);
    setEditTitle(hist.title || hist.type || '');
    setEditWorker(hist.worker || currentUser?.name || '김현장');
    setEditDate(hist.date || new Date().toISOString().slice(0, 10));
    setEditSummary(hist.summary || '');
    setEditPhotos(hist.photos ? [...hist.photos] : []);
    setViewingHistory(null); // Close detail modal if open
  };

  const handleEditFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const remainingSlots = 3 - editPhotos.length;
    if (remainingSlots <= 0) {
      showToast('사진은 최대 3장까지만 등록 가능합니다.', 'warning');
      return;
    }

    const count = Math.min(fileList.length, remainingSlots);
    for (let i = 0; i < count; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        showToast('이미지 파일만 업로드할 수 있습니다.', 'warning');
        continue;
      }

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          setEditPhotos((prev) => {
            if (prev.length >= 3) return prev;
            return [...prev, result];
          });
        }
      };
      reader.readAsDataURL(file);
    }

    if (editFileInputRef.current) {
      editFileInputRef.current.value = '';
    }
  };

  const handleAddEditSamplePhoto = () => {
    if (editPhotos.length >= 3) {
      showToast('사진은 최대 3장까지만 등록 가능합니다.', 'warning');
      return;
    }

    const sampleThemes = [
      { title: `${cell.cellName} 선로 정비 사진`, subtitle: '단자함 점검 완료', color: '#173B57' },
      { title: `${cell.cellName} RF 레벨 측정`, subtitle: '출력 정상 확인 (+38dBmV)', color: '#2878B5' },
      { title: `${cell.cellName} 방호관 보강 작업`, subtitle: '안전 이격거리 확보', color: '#C25E00' },
    ];

    const currentSample = sampleThemes[editPhotos.length % sampleThemes.length];
    const sampleDataUrl = createPhotoDataUrl(
      currentSample.title,
      currentSample.subtitle,
      currentSample.color
    );

    setEditPhotos((prev) => [...prev, sampleDataUrl]);
    showToast('샘플 현장사진이 첨부되었습니다.', 'info');
  };

  const handleRemoveEditPhoto = (index: number) => {
    setEditPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHistory) return;
    if (!editTitle.trim()) {
      showToast('제목을 입력해주세요.', 'warning');
      return;
    }
    if (!editSummary.trim()) {
      showToast('작업내용을 입력해주세요.', 'warning');
      return;
    }

    updateCellHistory(cell.id, editingHistory.id, {
      title: editTitle.trim(),
      type: editTitle.trim(),
      date: editDate || new Date().toISOString().slice(0, 10),
      worker: editWorker.trim() || currentUser?.name || '김현장',
      summary: editSummary.trim(),
      photos: editPhotos,
    });

    setEditingHistory(null);
  };

  const handleDeleteHistory = (histId: string) => {
    if (window.confirm('해당 작업이력을 삭제하시겠습니까?')) {
      deleteCellHistory(cell.id, histId);
      setViewingHistory(null);
      setEditingHistory(null);
    }
  };

  // Lightbox trigger
  const openPhotoPreview = (photos: string[], title: string, initialIndex = 0) => {
    setPreview({ photos, initialIndex, title });
  };

  return (
    <div id="cell-history-section" className="space-y-3 pt-2">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-black text-[#173B57] flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#173B57] shadow-xs" />
          <span>작업이력</span>
          <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200">
            총 {cell.history?.length || 0}건
          </span>
        </h2>

        {canWrite ? <button
          type="button"
          onClick={() => {
            setHistTitle('');
            setHistWorker(currentUser?.name || '김현장');
            setHistDate(new Date().toISOString().slice(0, 10));
            setHistSummary('');
            setAttachedPhotos([]);
            setShowAddModal(true);
          }}
          className="px-3.5 sm:px-4 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>작업이력 등록</span>
        </button> : null}
      </div>

      {/* History Cards List */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3.5">
        {!cell.history || cell.history.length === 0 ? (
          <div className="py-10 text-center text-slate-400 space-y-2">
            <History className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-medium">등록된 작업 및 유지보수 이력이 없습니다.</p>
            {canWrite ? <button
              type="button"
              onClick={() => {
                setHistTitle('');
                setHistWorker(currentUser?.name || '김현장');
                setHistDate(new Date().toISOString().slice(0, 10));
                setHistSummary('');
                setAttachedPhotos([]);
                setShowAddModal(true);
              }}
              className="mt-2 text-xs font-bold text-[#173B57] hover:underline cursor-pointer"
            >
              첫 작업이력 등록하기
            </button> : null}
          </div>
        ) : (
          cell.history.map((hist, idx) => {
            const hasPhotos = hist.photos && hist.photos.length > 0;
            const primaryPhoto = hasPhotos ? hist.photos![0] : null;
            const photoCount = hist.photos?.length || 0;
            const displayTitle = hist.title || hist.type || '작업이력';

            return (
              <div
                key={hist.id || idx}
                onClick={() => setViewingHistory(hist)}
                className="group p-4 sm:p-4.5 bg-slate-50/80 hover:bg-slate-100/60 rounded-2xl border border-slate-200/80 hover:border-[#173B57]/50 transition-all space-y-3 shadow-2xs hover:shadow-md cursor-pointer relative"
              >
                {/* Header: Title on Left, Worker & Date on Right */}
                <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-slate-200/70">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-sm sm:text-base text-[#173B57] group-hover:text-[#173B57] transition">
                      {displayTitle}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-semibold text-slate-700">{hist.worker}</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{hist.date}</span>
                    </div>
                  </div>
                </div>

                {/* Card Content & 사진 1장 (대표사진) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
                  {/* Left: 작업내용 */}
                  <div className={hasPhotos ? 'md:col-span-8 space-y-1' : 'md:col-span-12 space-y-1'}>
                    <div className="text-[11px] font-bold text-slate-400">
                      작업내용
                    </div>
                    <div className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed whitespace-pre-wrap bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs min-h-[56px]">
                      {hist.summary}
                    </div>
                  </div>

                  {/* Right: 사진 한장 (대표사진) */}
                  {hasPhotos && primaryPhoto && (
                    <div className="md:col-span-4 space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                        <span className="flex items-center gap-1 text-[#173B57]">
                          <Camera className="w-3.5 h-3.5" />
                          <span>대표사진</span>
                        </span>
                        {photoCount > 1 && (
                          <span className="text-[10px] text-slate-400">
                            총 {photoCount}장
                          </span>
                        )}
                      </div>

                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          openPhotoPreview(hist.photos!, displayTitle, 0);
                        }}
                        className="relative rounded-xl overflow-hidden border border-slate-300 bg-white aspect-4/3 shadow-xs hover:shadow-md transition group/photo"
                      >
                        <img
                          src={primaryPhoto}
                          alt={`${displayTitle} 사진`}
                          className="w-full h-full object-cover group-hover/photo:scale-105 transition duration-200"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover/photo:bg-black/25 transition flex items-center justify-center">
                          <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover/photo:opacity-100 transition drop-shadow-md" />
                        </div>

                        {photoCount > 1 && (
                          <div className="absolute bottom-1.5 right-1.5 bg-black/75 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-md backdrop-blur-xs flex items-center gap-1 shadow-xs">
                            <ImageIcon className="w-3 h-3 text-orange-400" />
                            <span>+{photoCount - 1}장</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Hint & Edit Button */}
                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="group-hover:text-[#173B57] transition font-medium flex items-center gap-1">
                    <span>클릭하여 상세 보기 및 수정</span>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEdit(hist);
                      }}
                      className="px-2.5 py-1 text-xs font-bold text-[#173B57] bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>수정</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 1. 작업이력 상세 보기 모달 (클릭 시 오픈) */}
      {viewingHistory && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-[#173B57]" />
                <h3 className="font-black text-base sm:text-lg text-[#173B57]">
                  작업이력 상세 정보
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingHistory(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Details Content */}
            <div className="space-y-3.5">
              {/* Title & Metadata */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
                <div className="text-xs font-bold text-slate-400">제목</div>
                <div className="text-base font-black text-[#173B57]">
                  {viewingHistory.title || viewingHistory.type}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-400 font-medium">작업일자:</span>{' '}
                    <span className="font-bold text-slate-700 font-mono">{viewingHistory.date}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-medium">작업자:</span>{' '}
                    <span className="font-bold text-slate-700">{viewingHistory.worker}</span>
                  </div>
                </div>
              </div>

              {/* Summary Text */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-700">작업내용</div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">
                  {viewingHistory.summary}
                </div>
              </div>

              {/* Photos Gallery (최대 3장) */}
              {viewingHistory.photos && viewingHistory.photos.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-[#173B57]" />
                      <span>현장 사진 ({viewingHistory.photos.length}장)</span>
                    </div>
                    <span className="text-[11px] text-slate-400">사진을 클릭하면 크게 볼 수 있습니다</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {viewingHistory.photos.map((photo, pIdx) => (
                      <div
                        key={pIdx}
                        onClick={() =>
                          openPhotoPreview(
                            viewingHistory.photos!,
                            viewingHistory.title || viewingHistory.type,
                            pIdx
                          )
                        }
                        className="group relative rounded-xl overflow-hidden border border-slate-200 bg-white aspect-4/3 cursor-pointer shadow-2xs hover:shadow-md transition"
                      >
                        <img
                          src={photo}
                          alt={`사진 ${pIdx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition flex items-center justify-center">
                          <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition drop-shadow-md" />
                        </div>
                        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                          {pIdx === 0 ? '대표' : `${pIdx + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons: 수정, 삭제, 닫기 */}
            <div className="pt-3 border-t border-slate-200 flex gap-2">
              {canWrite ? <button
                type="button"
                onClick={() => handleDeleteHistory(viewingHistory.id)}
                className="px-3.5 h-11 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl border border-red-200 transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>삭제</span>
              </button> : null}

              {canWrite ? <button
                type="button"
                onClick={() => handleOpenEdit(viewingHistory)}
                className="flex-1 h-11 bg-[#173B57] hover:bg-[#122e44] text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
                <span>작업이력 수정</span>
              </button> : null}

              <button
                type="button"
                onClick={() => setViewingHistory(null)}
                className="px-4 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 작업이력 수정 모달 (Edit Modal) */}
      {editingHistory && canWrite && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-black text-base sm:text-lg text-[#173B57] flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#173B57]" />
                <span>작업이력 수정</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingHistory(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* Row 1: 제목 * */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  제목 *
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="예: 노이즈 측정 및 정비 / 단자함 점검"
                  required
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                />
              </div>

              {/* Row 2: Date & Worker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    작업 일자 *
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    required
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    작업자 *
                  </label>
                  <input
                    type="text"
                    value={editWorker}
                    onChange={(e) => setEditWorker(e.target.value)}
                    placeholder="작업자 이름 입력"
                    required
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                  />
                </div>
              </div>

              {/* Row 3: 작업내용 * */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  작업내용 *
                </label>
                <textarea
                  rows={3}
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  placeholder="작업 내용 및 조치 결과를 입력하세요"
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-[#173B57] outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Row 4: Photo Management (최대 3장) */}
              <div className="space-y-2 pt-1 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-[#173B57]" />
                    <span>현장 사진 수정</span>
                    <span className="text-[11px] font-extrabold text-[#173B57] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      최대 3장 ({editPhotos.length}/3)
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={handleAddEditSamplePhoto}
                    disabled={editPhotos.length >= 3}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                      editPhotos.length >= 3
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100 cursor-pointer'
                    }`}
                  >
                    <span>+ 샘플사진 추가</span>
                  </button>
                </div>

                {/* Upload Input */}
                <input
                  type="file"
                  ref={editFileInputRef}
                  onChange={handleEditFileUpload}
                  accept="image/*"
                  multiple
                  className="hidden"
                />

                {editPhotos.length < 3 && (
                  <div
                    onClick={() => editFileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-[#173B57] hover:bg-slate-50 rounded-xl p-3 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1"
                  >
                    <Upload className="w-5 h-5 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-600">
                      클릭하여 사진 추가 (최대 3장)
                    </p>
                    <p className="text-[10px] text-slate-400">
                      첫 번째 사진이 대표사진으로 표시됩니다
                    </p>
                  </div>
                )}

                {/* Photo Thumbnails with Delete button */}
                {editPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {editPhotos.map((photo, index) => (
                      <div
                        key={index}
                        className="relative rounded-xl overflow-hidden border border-slate-300 bg-white aspect-4/3 shadow-2xs group"
                      >
                        <img
                          src={photo}
                          alt={`사진 ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveEditPhoto(index)}
                          className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition cursor-pointer shadow-md"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {index === 0 ? '대표사진' : `사진 ${index + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingHistory(null)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl cursor-pointer transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#173B57] hover:bg-[#122e44] text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs cursor-pointer transition"
                >
                  수정 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. 작업이력 신규 등록 모달 (Add Modal) */}
      {showAddModal && canWrite && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-black text-base sm:text-lg text-[#173B57] flex items-center gap-2">
                <History className="w-5 h-5 text-[#F28C28]" />
                <span>{cell.cellName} 작업이력 등록</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              {/* Row 1: 제목 * */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  제목 *
                </label>
                <input
                  type="text"
                  value={histTitle}
                  onChange={(e) => setHistTitle(e.target.value)}
                  placeholder="예: 노이즈 측정 및 정비 / 단자함 점검"
                  required
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                />
              </div>

              {/* Row 2: Date & Worker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    작업 일자 *
                  </label>
                  <input
                    type="date"
                    value={histDate}
                    onChange={(e) => setHistDate(e.target.value)}
                    required
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    작업자 *
                  </label>
                  <input
                    type="text"
                    value={histWorker}
                    onChange={(e) => setHistWorker(e.target.value)}
                    placeholder="작업자 이름 입력"
                    required
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#173B57] focus:bg-white focus:border-[#173B57] outline-none"
                  />
                </div>
              </div>

              {/* Row 3: 작업내용 * */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  작업내용 *
                </label>
                <textarea
                  rows={3}
                  value={histSummary}
                  onChange={(e) => setHistSummary(e.target.value)}
                  placeholder="예: 수청동 622 전주 분기기 교체 후 RF 출력레벨 +38dBmV 정상 측정 완료"
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-[#173B57] outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Row 4: Photo Registration (최대 3장 입력) */}
              <div className="space-y-2 pt-1 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-[#173B57]" />
                    <span>현장 사진 등록</span>
                    <span className="text-[11px] font-extrabold text-[#173B57] bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      최대 3장 ({attachedPhotos.length}/3)
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={handleAddSamplePhoto}
                    disabled={attachedPhotos.length >= 3}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                      attachedPhotos.length >= 3
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100 cursor-pointer'
                    }`}
                  >
                    <span>+ 샘플사진 추가</span>
                  </button>
                </div>

                {/* Upload Area / Dropzone */}
                <input
                  type="file"
                  ref={addFileInputRef}
                  onChange={handleAddFileUpload}
                  accept="image/*"
                  multiple
                  className="hidden"
                />

                {attachedPhotos.length < 3 ? (
                  <div
                    onClick={() => addFileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-[#173B57] hover:bg-slate-50 rounded-xl p-3 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1"
                  >
                    <Upload className="w-5 h-5 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-600">
                      클릭하여 사진 첨부 (최대 3장)
                    </p>
                    <p className="text-[10px] text-slate-400">
                      JPG, PNG, GIF 이미지 지원 (첫 번째 사진이 대표사진으로 표시됩니다)
                    </p>
                  </div>
                ) : (
                  <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-center text-xs font-bold text-[#173B57]">
                    최대 3장의 사진이 모두 등록되었습니다.
                  </div>
                )}

                {/* Attached Photo Thumbnails */}
                {attachedPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {attachedPhotos.map((photo, index) => (
                      <div
                        key={index}
                        className="relative rounded-xl overflow-hidden border border-slate-300 bg-white aspect-4/3 shadow-2xs group"
                      >
                        <img
                          src={photo}
                          alt={`첨부사진 ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition cursor-pointer shadow-md"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {index === 0 ? '대표사진' : `사진 ${index + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl cursor-pointer transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#F28C28] hover:bg-[#d97718] text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs cursor-pointer transition"
                >
                  작업이력 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {preview ? (
        <InteractivePhotoViewer
          photos={preview.photos.map((url, index) => ({ id: `${index}-${url.slice(0, 24)}`, url, label: `${preview.title} 사진 ${index + 1}` }))}
          initialIndex={preview.initialIndex}
          title={preview.title}
          ariaLabel="셀 작업이력 사진 확대"
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
};
