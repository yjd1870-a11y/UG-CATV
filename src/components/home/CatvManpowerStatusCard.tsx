import React, { useState } from 'react';
import {
  Car,
  Check,
  Edit3,
  MapPin,
  Shield,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { canEditCatvManpower } from '../../shared/auth/permissions';
import { CatvManpowerStatus } from '../../types';

export const CatvManpowerStatusCard: React.FC = () => {
  const { currentUser, catvManpower, updateCatvManpower } = useApp();
  const canEdit = canEditCatvManpower(currentUser?.role);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<CatvManpowerStatus>(catvManpower);

  // Sync edit form when opening modal
  const handleOpenEdit = () => {
    if (!canEdit) return;
    setEditForm(JSON.parse(JSON.stringify(catvManpower)));
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const now = new Date();
    const timeStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const saved = await updateCatvManpower({
      ...editForm,
      lastUpdated: timeStr,
    });
    if (saved) setIsEditing(false);
  };

  const handleRegionChange = (
    index: number,
    field: 'headcount' | 'aerialVehicles' | 'passengerVehicles',
    value: number
  ) => {
    setEditForm((prev) => {
      const newRegions = [...prev.regions];
      newRegions[index] = {
        ...newRegions[index],
        [field]: Math.max(0, value),
      };
      return { ...prev, regions: newRegions };
    });
  };

  const handleManagementChange = (
    field: 'director' | 'generalManager' | 'adminTeam',
    value: number
  ) => {
    setEditForm((prev) => ({
      ...prev,
      management: {
        ...prev.management,
        [field]: Math.max(0, value),
      },
    }));
  };

  // Calculations
  const totalFieldStaff = catvManpower.regions.reduce((acc, r) => acc + r.headcount, 0);
  const totalAerialVehicles = catvManpower.regions.reduce((acc, r) => acc + r.aerialVehicles, 0);
  const totalPassengerVehicles = catvManpower.regions.reduce((acc, r) => acc + r.passengerVehicles, 0);
  const totalManagementStaff =
    catvManpower.management.director +
    catvManpower.management.generalManager +
    catvManpower.management.adminTeam;
  const grandTotalPersonnel = totalFieldStaff + totalManagementStaff;

  return (
    <section
      id="catv-manpower-status-section"
      className="bg-white rounded-2xl shadow-sm p-5 sm:p-6 border border-[#E5E7EB] space-y-4"
    >
      {/* Header with Title & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[#E5E7EB]">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black bg-[#173B57] text-white tracking-wide">
              <Users className="w-3.5 h-3.5 text-[#F28C28]" />
              CATV 인력현황
            </span>
            <span className="text-xs text-[#6B7280] font-medium">
              권역별 전송망 현장팀 및 차량 배치 현황
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-[11px] text-[#9CA3AF] font-mono">
            기준: {catvManpower.lastUpdated || '2026.08.10'}
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={handleOpenEdit}
              className="h-8 px-3 rounded-lg bg-[#F9FAFB] hover:bg-slate-100 active:bg-slate-200 border border-[#D1D5DB] text-[#173B57] text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="인력 및 차량 현황 수치 수정"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#2878B5]" />
              <span>현황 수정</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Top Management & Administration Staff Banner */}
      <div className="bg-[#F9FAFB] rounded-xl p-3.5 border border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#173B57] bg-white px-2.5 py-1 rounded-lg border border-[#D1D5DB] shadow-2xs flex items-center gap-1.5 shrink-0">
            <Shield className="w-3.5 h-3.5 text-[#2878B5]" />
            본부 및 관리
          </span>
          <div className="text-xs sm:text-sm font-black text-[#1F2937] flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="text-[#6B7280] font-normal">소장</span>
              <strong className="text-[#173B57]">{catvManpower.management.director}명</strong>
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span className="flex items-center gap-1">
              <span className="text-[#6B7280] font-normal">총괄팀장</span>
              <strong className="text-[#173B57]">{catvManpower.management.generalManager}명</strong>
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span className="flex items-center gap-1">
              <span className="text-[#6B7280] font-normal">행정팀</span>
              <strong className="text-[#173B57]">{catvManpower.management.adminTeam}명</strong>
            </span>
          </div>
        </div>

        <div className="text-[11px] font-bold text-[#2878B5] bg-blue-50/70 border border-blue-200/80 px-2.5 py-1 rounded-lg shrink-0 self-start sm:self-auto">
          관리인력 총 {totalManagementStaff}명
        </div>
      </div>

      {/* 4 Regional Items Grid without redundant text and location badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {catvManpower.regions.map((region) => (
          <div
            key={region.id}
            className="bg-white rounded-xl p-3.5 sm:p-4 border border-[#E5E7EB] hover:border-[#2878B5]/50 hover:shadow-xs transition space-y-3 flex flex-col justify-between"
          >
            {/* Region Title Line */}
            <div className="flex items-center justify-between gap-1">
              <span className="font-extrabold text-sm sm:text-base text-[#173B57] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#2878B5]" />
                {region.regionName}
              </span>
            </div>

            {/* 3 Clean Metric Pills */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2 text-center">
                <div className="text-[11px] text-[#2878B5] font-semibold flex items-center justify-center gap-1 whitespace-nowrap">
                  <Users className="w-3 h-3 shrink-0" />
                  <span>인원</span>
                </div>
                <div className="text-sm sm:text-base font-black text-[#173B57] mt-1">
                  {region.headcount}
                  <span className="text-[10px] font-normal text-[#6B7280] ml-0.5">명</span>
                </div>
              </div>

              <div className="bg-amber-50/70 border border-amber-200/60 rounded-lg p-2 text-center">
                <div className="text-[11px] text-amber-700 font-semibold flex items-center justify-center gap-1 whitespace-nowrap">
                  <Truck className="w-3 h-3 shrink-0" />
                  <span>고소차</span>
                </div>
                <div className="text-sm sm:text-base font-black text-amber-900 mt-1">
                  {region.aerialVehicles}
                  <span className="text-[10px] font-normal text-[#6B7280] ml-0.5">대</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                <div className="text-[11px] text-[#6B7280] font-semibold flex items-center justify-center gap-1 whitespace-nowrap">
                  <Car className="w-3 h-3 shrink-0" />
                  <span>승용차</span>
                </div>
                <div className="text-sm sm:text-base font-black text-[#1F2937] mt-1">
                  {region.passengerVehicles}
                  <span className="text-[10px] font-normal text-[#6B7280] ml-0.5">대</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Aggregate Totals Summary Footer Bar */}
      <div className="pt-2 border-t border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-4 flex-wrap text-[#6B7280] font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            현장인원: <strong className="text-[#173B57]">{totalFieldStaff}명</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            고소차 총계: <strong className="text-amber-800">{totalAerialVehicles}대</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            승용차 총계: <strong className="text-[#2878B5]">{totalPassengerVehicles}대</strong>
          </span>
        </div>

        <div className="bg-[#173B57] text-white px-3 py-1.5 rounded-xl font-bold text-xs flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <span className="text-[11px] text-slate-300 font-normal">전사 총 인력 합계:</span>
          <span className="text-sm font-black text-[#F28C28]">{grandTotalPersonnel}명</span>
        </div>
      </div>

      {/* EDIT MODAL */}
      {isEditing && canEdit && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-[#E5E7EB] animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB] mb-4">
              <h3 className="font-extrabold text-base text-[#173B57] flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#2878B5]" />
                <span>CATV 인력현황 수치 수정</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="p-1 text-[#9CA3AF] hover:text-[#1F2937] rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              {/* Management Staff Section */}
              <div className="bg-[#F9FAFB] p-3.5 rounded-xl border border-[#E5E7EB] space-y-2.5">
                <div className="font-bold text-[#173B57] flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#2878B5]" />
                  <span>본부 / 관리인력</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[#6B7280] font-bold mb-1">소장 (명)</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.management.director}
                      onChange={(e) =>
                        handleManagementChange('director', Number(e.target.value))
                      }
                      className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded-lg text-center font-bold text-[#173B57]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[#6B7280] font-bold mb-1">총괄팀장 (명)</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.management.generalManager}
                      onChange={(e) =>
                        handleManagementChange('generalManager', Number(e.target.value))
                      }
                      className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded-lg text-center font-bold text-[#173B57]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[#6B7280] font-bold mb-1">행정팀 (명)</label>
                    <input
                      type="number"
                      min={0}
                      value={editForm.management.adminTeam}
                      onChange={(e) =>
                        handleManagementChange('adminTeam', Number(e.target.value))
                      }
                      className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded-lg text-center font-bold text-[#173B57]"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* 4 Regions Section */}
              <div className="space-y-3">
                <div className="font-bold text-[#173B57] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#F28C28]" />
                  <span>권역별 현장 거점 인력 및 차량</span>
                </div>

                {editForm.regions.map((reg, idx) => (
                  <div
                    key={reg.id}
                    className="p-3 bg-white border border-[#E5E7EB] rounded-xl space-y-2"
                  >
                    <div className="font-bold text-sm text-[#173B57]">
                      {reg.regionName}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-[#6B7280] font-medium mb-1">
                          인원 (명)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={reg.headcount}
                          onChange={(e) =>
                            handleRegionChange(idx, 'headcount', Number(e.target.value))
                          }
                          className="w-full h-9 px-2 bg-[#F9FAFB] border border-[#D1D5DB] rounded-lg text-center font-bold text-[#173B57]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#6B7280] font-medium mb-1">
                          고소차 (대)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={reg.aerialVehicles}
                          onChange={(e) =>
                            handleRegionChange(idx, 'aerialVehicles', Number(e.target.value))
                          }
                          className="w-full h-9 px-2 bg-[#F9FAFB] border border-[#D1D5DB] rounded-lg text-center font-bold text-amber-800"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#6B7280] font-medium mb-1">
                          승용차 (대)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={reg.passengerVehicles}
                          onChange={(e) =>
                            handleRegionChange(idx, 'passengerVehicles', Number(e.target.value))
                          }
                          className="w-full h-9 px-2 bg-[#F9FAFB] border border-[#D1D5DB] rounded-lg text-center font-bold text-[#1F2937]"
                          required
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 border-t border-[#E5E7EB]">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 h-11 bg-[#F9FAFB] hover:bg-slate-200 border border-[#D1D5DB] text-[#4B5563] font-bold rounded-xl transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#2878B5] hover:bg-[#1e5c8b] text-white font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>수정내용 저장</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
