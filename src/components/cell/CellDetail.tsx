import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  Camera,
  ChevronRight,
  Copy,
  History,
  Radio,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';
import { FloorPlanViewer } from './FloorPlanViewer';
import { PhotoGalleryModal } from './PhotoGalleryModal';
import { StraightDiagramViewer } from './StraightDiagramViewer';
import { CellHistorySection } from './CellHistorySection';

export const CellDetail: React.FC = () => {
  const {
    cells,
    selectedCellId,
    navigateTo,
    showToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    '국사현황' | 'HFC현황' | '직선도' | '작업이력'
  >('국사현황');

  // Modals for Floor Plan & Photos triggered from buttons
  const [showFloorPlanModal, setShowFloorPlanModal] = useState(false);
  const [floorPlanTarget, setFloorPlanTarget] = useState<string>('');
  const [showPhotoGalleryModal, setShowPhotoGalleryModal] = useState(false);

  const cell =
    cells.find((c) => c.id === selectedCellId || c.cellName === selectedCellId) ||
    cells[0];

  if (!cell) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <div className="text-sm font-bold text-slate-700">
          선택된 CELL을 찾을 수 없습니다.
        </div>
        <button
          onClick={() => navigateTo('cell_list')}
          className="mt-3 px-4 py-2 bg-[#2878B5] text-white text-xs font-bold rounded-xl"
        >
          CELL 목록으로 이동
        </button>
      </div>
    );
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} 복사되었습니다: ${text}`, 'info');
  };

  const tabs: Array<'국사현황' | 'HFC현황' | '직선도' | '작업이력'> = [
    '국사현황',
    'HFC현황',
    '직선도',
    '작업이력',
  ];

  // Default fallback data for stationDetails and hfcDetails if not present
  const stationDetails = cell.stationDetails || {
    descriptionCode: '#G565460',
    stationName: '기남_마평국사',
    stationAddress: '용인시 처인구 마평동 534번지 2층',
    lineInfoList: [
      { item: 'OTX (주)', node: '백암간 288c', lineNo: '256' },
      { item: 'ORX (주)', node: '백암간 288c', lineNo: '257' },
      { item: '예비', node: '', lineNo: '' },
    ],
    transceiverList: [
      { item: 'OTX', rack: '101', shelf: '2', port: '10', model: '모토로라' },
      { item: 'ORX', rack: '101', shelf: '2', port: '16', model: '모토로라' },
    ],
  };

  const hfcDetails = cell.hfcDetails || {
    onu: {
      location: '백암면 백봉리 1559',
      manufacturer: '모토로라',
      modelName: 'SG-4000',
      divisionType: '1*1',
      cellConfig: '전송망',
    },
    ups: {
      location: '처인구 백암면 백봉리 1559',
      manufacturer: 'ES테크',
      modelName: 'FA-1000P',
    },
  };

  const handleOpenFloorPlan = (target: string) => {
    setFloorPlanTarget(target);
    setShowFloorPlanModal(true);
  };

  return (
    <div id="cell-detail-view" className="space-y-4 pb-24 sm:pb-8 text-[#1F2937]">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateTo('cell_list')}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#173B57] hover:text-[#2878B5] bg-white px-3.5 py-2 rounded-xl border border-[#E5E7EB] shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>CELL 목록</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => copyToClipboard(cell.cellName, 'CELL명이')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#173B57] bg-white px-3 py-2 rounded-xl border border-[#E5E7EB] shadow-xs transition cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>CELL명 복사</span>
          </button>
          <button
            onClick={() => navigateTo('material_list')}
            className="inline-flex items-center gap-1 text-xs font-bold text-white bg-[#F28C28] hover:bg-[#d97718] px-3.5 py-2 rounded-xl shadow-sm transition cursor-pointer"
          >
            <span>자재사용 등록</span>
          </button>
        </div>
      </div>

      {/* Prominent CELL Header Banner (Red bordered sections deleted as requested) */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-black text-[#173B57] tracking-tight">
            CELL : {cell.cellName}
          </h1>
          <StatusBadge status={cell.status} size="md" />
        </div>

        {/* 4 Requested Tabs Bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-[#E5E7EB] pb-1 pt-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              id={`cell-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-xs font-extrabold rounded-xl whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === tab
                  ? 'bg-[#173B57] text-white shadow-xs'
                  : 'bg-[#F9FAFB] border border-[#E5E7EB] text-[#6B7280] hover:bg-slate-100 hover:text-[#173B57]'
              }`}
            >
              {tab === '국사현황' && <Building2 className="w-3.5 h-3.5" />}
              {tab === 'HFC현황' && <Activity className="w-3.5 h-3.5" />}
              {tab === '직선도' && <Radio className="w-3.5 h-3.5" />}
              {tab === '작업이력' && <History className="w-3.5 h-3.5" />}
              <span>{tab}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content 1: 국사현황 (Image 2 specs) + 작업이력 directly underneath */}
      {activeTab === '국사현황' && (
        <div className="space-y-4">
          {/* 1. 국사 정보 Section */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
            <h2 className="text-base sm:text-lg font-black text-[#173B57] flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#173B57] shadow-xs" />
              <span>국사 정보</span>
            </h2>

            {/* Table layout matching Image 2 */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200">
                <div className="flex">
                  <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                    설명
                  </div>
                  <div className="p-3 font-semibold text-[#173B57] flex items-center">
                    {stationDetails.descriptionCode}
                  </div>
                </div>
                <div className="flex">
                  <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                    국사
                  </div>
                  <div className="p-3 font-semibold text-[#173B57] flex items-center">
                    {stationDetails.stationName}
                  </div>
                </div>
              </div>

              <div className="flex">
                <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                  국사주소
                </div>
                <div className="p-3 font-semibold text-[#1F2937] flex items-center">
                  {stationDetails.stationAddress}
                </div>
              </div>
            </div>
          </div>

          {/* 2. 국사 현황 Section */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-4">
            {/* Title & Straight Diagram Action Button */}
            <div className="flex items-center justify-between gap-2 pb-1">
              <h2 className="text-base sm:text-lg font-black text-[#173B57] flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#173B57] shadow-xs" />
                <span>국사 현황</span>
              </h2>

              <button
                type="button"
                onClick={() => setActiveTab('직선도')}
                className="px-4 sm:px-6 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md active:scale-95 transition cursor-pointer flex items-center gap-1.5"
              >
                <span>직선도 보기</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Sub-section 2.1: 선번정보 */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-[#1F2937]">
                선번정보
              </h3>

              <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto shadow-2xs">
                <table className="w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="bg-[#173B57] text-white font-bold">
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/4">항목</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/3">노드</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/4">선번</th>
                      <th className="py-2.5 px-3 w-20">평면도</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800 font-medium">
                    {stationDetails.lineInfoList.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition">
                        <td className="py-2.5 px-3 border-r border-slate-200 font-semibold text-[#173B57]">
                          {row.item}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200">
                          {row.node || '-'}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono">
                          {row.lineNo || '-'}
                        </td>
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            onClick={() => handleOpenFloorPlan(`${row.item} ${row.node}`)}
                            className="px-3 py-1 text-xs font-bold text-red-500 bg-white border border-red-300 rounded-md hover:bg-red-50 transition cursor-pointer active:scale-95"
                          >
                            이동
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sub-section 2.2: 송수신기 정보 */}
            <div className="space-y-2 pt-2">
              <h3 className="text-xs sm:text-sm font-bold text-[#1F2937] flex items-center gap-1.5">
                <span className="w-1 h-3.5 bg-[#173B57] rounded-xs" />
                <span>송수신기 정보</span>
              </h3>

              <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto shadow-2xs">
                <table className="w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="bg-[#173B57] text-white font-bold">
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/6">항목</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/6">랙</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/6">쉘프</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/6">포트</th>
                      <th className="py-2.5 px-3 border-r border-white/20 w-1/4">모델명</th>
                      <th className="py-2.5 px-3 w-20">평면도</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800 font-medium">
                    {stationDetails.transceiverList.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition">
                        <td className="py-2.5 px-3 border-r border-slate-200 font-semibold text-[#173B57]">
                          {row.item}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono">
                          {row.rack}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono">
                          {row.shelf}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono">
                          {row.port}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-semibold">
                          {row.model}
                        </td>
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            onClick={() => handleOpenFloorPlan(`송수신기 ${row.item} (랙 ${row.rack})`)}
                            className="px-3 py-1 text-xs font-bold text-red-500 bg-white border border-red-300 rounded-md hover:bg-red-50 transition cursor-pointer active:scale-95"
                          >
                            이동
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 3. 작업이력 Section (directly underneath 국사현황 as requested) */}
          <CellHistorySection cell={cell} />
        </div>
      )}

      {/* Tab Content 2: HFC현황 (Image 3 specs) + 작업이력 directly underneath */}
      {activeTab === 'HFC현황' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 sm:p-6 border border-[#E5E7EB] shadow-sm space-y-5">
            <h2 className="text-base sm:text-lg font-black text-[#173B57] flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#173B57] shadow-xs" />
              <span>HFC 현황</span>
            </h2>

            {/* Card 1: ONU Section */}
            <div className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-sm sm:text-base font-extrabold text-[#173B57] flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-[#173B57] rounded-xs" />
                  <span>ONU</span>
                </h3>
              </div>

              {/* ONU Table layout */}
              <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                <div className="flex border-b border-slate-200">
                  <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                    위치
                  </div>
                  <div className="p-3 font-semibold text-[#1F2937] flex items-center">
                    {hfcDetails.onu.location}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200">
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      제조사
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.onu.manufacturer}
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      모델명
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.onu.modelName}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      분할구분
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.onu.divisionType}
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      셀구성
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.onu.cellConfig}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: UPS Section */}
            <div className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between pb-1">
                <h3 className="text-sm sm:text-base font-extrabold text-[#173B57] flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-[#173B57] rounded-xs" />
                  <span>UPS</span>
                </h3>
              </div>

              {/* UPS Table layout */}
              <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                <div className="flex border-b border-slate-200">
                  <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                    위치
                  </div>
                  <div className="p-3 font-semibold text-[#1F2937] flex items-center">
                    {hfcDetails.ups.location}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      제조사
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.ups.manufacturer}
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-24 sm:w-28 bg-slate-50 font-bold text-slate-700 p-3 flex items-center justify-center border-r border-slate-200 shrink-0">
                      모델명
                    </div>
                    <div className="p-3 font-semibold text-[#173B57] flex items-center">
                      {hfcDetails.ups.modelName}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. 작업이력 Section (directly underneath HFC현황 as requested) */}
          <CellHistorySection cell={cell} />
        </div>
      )}

      {/* Tab Content 3: 직선도 */}
      {activeTab === '직선도' && <StraightDiagramViewer cell={cell} />}

      {/* Tab Content 4: 작업이력 (Standalone view) */}
      {activeTab === '작업이력' && <CellHistorySection cell={cell} />}

      {/* Floor Plan Popup Modal triggered by [이동] button */}
      {showFloorPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#173B57]" />
                <h3 className="font-black text-base text-[#173B57]">
                  국사 평면도 및 설비 위치 {floorPlanTarget ? `(${floorPlanTarget})` : ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFloorPlanModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <FloorPlanViewer cell={cell} target={floorPlanTarget.replace(/^송수신기\s+|\s*\(랙\s*|\)$/g, '')} />

            <button
              type="button"
              onClick={() => setShowFloorPlanModal(false)}
              className="w-full h-11 bg-[#173B57] hover:bg-[#122e44] text-white font-bold rounded-xl transition cursor-pointer"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Photo Gallery Modal triggered by [현장사진] button */}
      {showPhotoGalleryModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-[#F28C28]" />
                <h3 className="font-black text-base text-[#173B57]">
                  {cell.cellName} HFC 현장설비 사진
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPhotoGalleryModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <PhotoGalleryModal
              cellId={cell.id}
              cellName={cell.cellName}
              photos={cell.photos}
            />

            <button
              type="button"
              onClick={() => setShowPhotoGalleryModal(false)}
              className="w-full h-11 bg-[#173B57] hover:bg-[#122e44] text-white font-bold rounded-xl transition cursor-pointer"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
