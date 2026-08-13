import React, { useState } from 'react';
import {
  Boxes,
  Calendar,
  ChevronRight,
  Filter,
  Layers,
  MapPin,
  Package,
  Plus,
  Radio,
  Search,
  Sparkles,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  MATERIAL_CATEGORIES,
  MaterialCategory,
  MaterialUsageRecord,
} from '../../types';

export const MaterialView: React.FC = () => {
  const {
    currentUser,
    cells,
    materialUsage,
    addMaterialUsage,
    selectCell,
  } = useApp();

  const [showModal, setShowModal] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('전체');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // Form states
  const [workDate, setWorkDate] = useState('2026-08-10');
  const [workerName, setWorkerName] = useState(currentUser?.name || '김현장');
  const [cellName, setCellName] = useState('OSAN-001');
  const [materialName, setMaterialName] = useState<MaterialCategory>('TAP');
  const [spec, setSpec] = useState('8-TAP 17dB');
  const [quantity, setQuantity] = useState<number>(2);
  const [unit, setUnit] = useState('EA');
  const [purpose, setPurpose] = useState('노후 분기기 교체 및 신호 감쇄 개선');
  const [workDetails, setWorkDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Auto-fill spec suggestions when material category changes
  const handleMaterialChange = (mat: MaterialCategory) => {
    setMaterialName(mat);
    switch (mat) {
      case '동축케이블':
        setSpec('500-JC (가공용)');
        setUnit('m');
        setQuantity(50);
        break;
      case '광케이블':
        setSpec('SM 4-Core Loose Tube');
        setUnit('m');
        setQuantity(80);
        break;
      case 'Connector':
        setSpec('500-Pin 옥외방수 콘넥타');
        setUnit('EA');
        setQuantity(4);
        break;
      case 'TAP':
        setSpec('8-TAP 17dB');
        setUnit('EA');
        setQuantity(2);
        break;
      case 'Splitter':
        setSpec('2-Way 광대역 분배기 (5~1000MHz)');
        setUnit('EA');
        setQuantity(2);
        break;
      case 'AMP':
        setSpec('TBA-870 간선증폭기 모듈');
        setUnit('EA');
        setQuantity(1);
        break;
      case '광모듈':
        setSpec('SFP+ 10G 1310nm 10km');
        setUnit('EA');
        setQuantity(2);
        break;
      default:
        setSpec('일반 자재');
        setUnit('EA');
        setQuantity(1);
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!materialName || quantity <= 0) return;

    addMaterialUsage({
      workDate,
      workerName: workerName || currentUser?.name || '김현장',
      cellName,
      materialName,
      spec: spec.trim() || '기본 규격',
      quantity,
      unit,
      purpose: purpose.trim() || '현장 유지보수',
      workDetails: workDetails.trim() || `${cellName} 현장 자재 사용`,
      remarks: remarks.trim() || undefined,
    });

    setShowModal(false);
    setWorkDetails('');
    setRemarks('');
  };

  // Filter materials
  const filteredMaterials = materialUsage.filter((item) => {
    const matchCategory =
      filterCategory === '전체' || item.materialName === filterCategory;

    const query = searchKeyword.trim().toLowerCase();
    const matchQuery =
      !query ||
      item.cellName.toLowerCase().includes(query) ||
      item.materialName.toLowerCase().includes(query) ||
      item.spec.toLowerCase().includes(query) ||
      item.purpose.toLowerCase().includes(query) ||
      item.workerName.toLowerCase().includes(query);

    return matchCategory && matchQuery;
  });

  const totalUsedUnits = filteredMaterials.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div id="material-view" className="space-y-4 pb-20 sm:pb-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-[#2878B5]" />
            <h1 className="text-xl font-extrabold text-[#173B57]">
              자재사용 내역
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            현장 사용 자재 (동축/광케이블, 콘넥타, TAP, 증폭기 등) 실시간 등록 및 불출 관리
          </p>
        </div>

        <button
          id="material-register-btn"
          onClick={() => {
            setWorkerName(currentUser?.name || '김현장');
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs font-bold rounded-xl shadow-xs transition self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ 자재사용 등록</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-[#E5E7EB] space-y-3">
        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <span className="text-[11px] font-bold text-[#6B7280] shrink-0 mr-1">
            자재 구분:
          </span>
          {['전체', ...MATERIAL_CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition cursor-pointer ${
                filterCategory === cat
                  ? 'bg-[#173B57] text-white shadow-xs'
                  : 'bg-[#F9FAFB] border border-[#E5E7EB] text-[#6B7280] hover:bg-slate-100 hover:text-[#173B57]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="CELL명, 자재명, 규격, 작업자, 사용목적 검색"
            className="w-full h-11 pl-10 pr-10 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl text-xs font-medium focus:bg-white focus:border-[#2878B5] outline-none transition text-[#1F2937] placeholder-[#9CA3AF]"
          />
          {searchKeyword && (
            <button
              onClick={() => setSearchKeyword('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Summary Banner */}
      <div className="bg-[#F9FAFB] p-3.5 rounded-xl border border-[#E5E7EB] flex items-center justify-between text-xs text-[#6B7280]">
        <div>
          등록된 내역: <strong className="text-[#173B57]">{filteredMaterials.length}건</strong>
        </div>
        <div>
          총 불출 수량: <strong className="text-[#2878B5]">{totalUsedUnits}</strong> (단위 합산)
        </div>
      </div>

      {/* Material Usage Cards List */}
      <div className="space-y-3">
        {filteredMaterials.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#E5E7EB]">
            <Package className="w-10 h-10 mx-auto text-[#9CA3AF] mb-2" />
            <div className="text-sm font-bold text-[#1F2937]">
              등록된 자재사용 내역이 없습니다.
            </div>
            <div className="text-xs text-[#6B7280] mt-1">
              [+ 자재사용 등록] 버튼을 눌러 현장 사용 내역을 추가하세요.
            </div>
          </div>
        ) : (
          filteredMaterials.map((mat) => (
            <div
              key={mat.id}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm hover:border-[#2878B5]/40 transition space-y-3"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-sm sm:text-base text-[#173B57]">
                      {mat.materialName}
                    </span>
                    <span className="text-xs font-semibold text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                      {mat.spec}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-[#2878B5] mt-1.5">
                    사용목적: {mat.purpose}
                  </div>
                </div>

                {/* Big Quantity Pill */}
                <div className="bg-blue-50/70 border border-blue-200/80 px-3.5 py-1.5 rounded-xl text-right shrink-0">
                  <span className="text-[10px] text-[#2878B5] font-bold block leading-none">
                    사용수량
                  </span>
                  <span className="text-base font-black text-[#173B57] leading-none mt-1">
                    {mat.quantity}{' '}
                    <span className="text-xs font-normal text-[#6B7280]">{mat.unit}</span>
                  </span>
                </div>
              </div>

              {/* Work Details & CELL Reference */}
              {mat.workDetails && (
                <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] text-xs text-[#4B5563] font-medium leading-relaxed">
                  {mat.workDetails}
                </div>
              )}

              {/* Meta Grid */}
              <div className="pt-2 border-t border-[#E5E7EB] flex items-center justify-between text-[11px] text-[#6B7280] flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => selectCell(mat.cellName)}
                    className="font-bold text-[#173B57] hover:text-[#2878B5] underline flex items-center gap-1 cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5 text-[#2878B5]" />
                    <span>CELL: {mat.cellName}</span>
                  </button>
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-[#9CA3AF]" />
                    <span>작업자: {mat.workerName}</span>
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[#9CA3AF] font-mono">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{mat.workDate}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Register Material Modal (Section 11) */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-[#E5E7EB] animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB] mb-4">
              <h3 className="font-extrabold text-base text-[#173B57] flex items-center gap-2">
                <Boxes className="w-5 h-5 text-[#F28C28]" />
                <span>자재사용 등록</span>
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-[#9CA3AF] hover:text-[#1F2937] rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-3.5 text-xs">
              {/* Row 1: 작업일자 & 작업자 */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    작업일자 *
                  </label>
                  <input
                    type="date"
                    value={workDate}
                    onChange={(e) => setWorkDate(e.target.value)}
                    required
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    작업자 *
                  </label>
                  <input
                    type="text"
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    required
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  />
                </div>
              </div>

              {/* Row 2: CELL명 & 자재명 */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    CELL명 *
                  </label>
                  <select
                    value={cellName}
                    onChange={(e) => setCellName(e.target.value)}
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  >
                    {cells.map((c) => (
                      <option key={c.id} value={c.cellName}>
                        {c.cellName} ({c.region})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    자재명 *
                  </label>
                  <select
                    value={materialName}
                    onChange={(e) =>
                      handleMaterialChange(e.target.value as MaterialCategory)
                    }
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  >
                    {MATERIAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: 규격 & 사용수량 & 단위 */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-1">
                  <label className="block font-bold text-[#6B7280] mb-1">
                    규격 *
                  </label>
                  <input
                    type="text"
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                    required
                    placeholder="예: 8-TAP 17dB"
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    사용수량 *
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                    required
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-bold text-[#173B57] focus:bg-white focus:border-[#2878B5] outline-none text-center"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#6B7280] mb-1">
                    단위 *
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                  >
                    <option value="EA">EA (개)</option>
                    <option value="m">m (미터)</option>
                    <option value="Box">Box (박스)</option>
                    <option value="Set">Set (세트)</option>
                  </select>
                </div>
              </div>

              {/* 사용목적 */}
              <div>
                <label className="block font-bold text-[#6B7280] mb-1">
                  사용목적 *
                </label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="예: 노후 분기기 교체 및 신호 감쇄 개선"
                  required
                  className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                />
              </div>

              {/* 작업내용 */}
              <div>
                <label className="block font-bold text-[#6B7280] mb-1">
                  작업내용
                </label>
                <textarea
                  rows={2}
                  value={workDetails}
                  onChange={(e) => setWorkDetails(e.target.value)}
                  placeholder="예: 수청동 현대아파트 102동 앞 전주 분기기 교체 후 RF 레벨 정상 복구"
                  className="w-full p-2.5 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none resize-none text-[#1F2937] placeholder-[#9CA3AF]"
                />
              </div>

              {/* 비고 */}
              <div>
                <label className="block font-bold text-[#6B7280] mb-1">
                  비고
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="폐자재 회수 여부 등"
                  className="w-full h-10 px-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl font-medium focus:bg-white focus:border-[#2878B5] outline-none text-[#1F2937]"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-11 bg-[#F9FAFB] hover:bg-slate-200 border border-[#D1D5DB] text-[#4B5563] font-bold rounded-xl transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#F28C28] hover:bg-[#d97718] text-white font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  자재사용 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
