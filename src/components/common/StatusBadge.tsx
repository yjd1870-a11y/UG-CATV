import React from 'react';
import { CellStatus, TransferStatus } from '../../types';

interface StatusBadgeProps {
  status: TransferStatus | CellStatus | string;
  size?: 'sm' | 'md' | 'lg';
  showDot?: boolean;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showDot = true,
  className = '',
}) => {
  let bgClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let dotClass = 'bg-slate-500';

  // Transfer Statuses: 대기 (Gray), 작업중 (Blue), 업무이관 (Orange), 완료 (Green)
  // Cell Statuses: 정상 (Green), 점검필요 (Orange), 노이즈발생 (Amber), 장애 (Red)
  switch (status) {
    case '대기':
      bgClass = 'bg-slate-100 text-slate-700 border-slate-300';
      dotClass = 'bg-slate-500';
      break;
    case '작업중':
      bgClass = 'bg-blue-50 text-[#2878B5] border-blue-200';
      dotClass = 'bg-[#2878B5] animate-pulse';
      break;
    case '업무이관':
    case '이관':
      bgClass = 'bg-amber-50 text-[#F28C28] border-amber-200';
      dotClass = 'bg-[#F28C28]';
      break;
    case '완료':
    case '정상':
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      dotClass = 'bg-emerald-600';
      break;
    case '점검필요':
      bgClass = 'bg-orange-50 text-orange-700 border-orange-200';
      dotClass = 'bg-orange-600';
      break;
    case '노이즈발생':
    case '상향노이즈':
      bgClass = 'bg-amber-50 text-amber-800 border-amber-300';
      dotClass = 'bg-amber-600 animate-pulse';
      break;
    case '장애':
    case '출력저하':
    case '단선':
      bgClass = 'bg-red-50 text-red-700 border-red-200';
      dotClass = 'bg-red-600 animate-ping';
      break;
    default:
      bgClass = 'bg-gray-100 text-gray-700 border-gray-200';
      dotClass = 'bg-gray-400';
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 rounded-md gap-1',
    md: 'text-xs font-semibold px-2.5 py-1 rounded-md gap-1.5',
    lg: 'text-sm font-bold px-3 py-1.5 rounded-lg gap-2',
  };

  return (
    <span
      className={`inline-flex items-center border whitespace-nowrap ${sizeClasses[size]} ${bgClass} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />}
      <span>{status}</span>
    </span>
  );
};
