import React from 'react';
import { ArrowLeft, BookOpen, FileText } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ManualView: React.FC = () => {
  const { navigateTo } = useApp();
  return (
    <section id="manual-view" className="space-y-5">
      <button type="button" onClick={() => navigateTo('home')} className="flex items-center gap-2 text-sm font-bold text-[#173B57]">
        <ArrowLeft className="h-4 w-4" />홈으로
      </button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
        <h1 className="flex items-center gap-3 text-xl font-extrabold text-[#173B57]"><BookOpen className="h-7 w-7 text-teal-600" />현장 장비 매뉴얼</h1>
        <p className="mt-2 text-sm text-slate-500">OTDR · 접광기 등 광장비 사용방법</p>
        <div className="mt-8 flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center" role="status">
          <FileText className="h-10 w-10 text-slate-400" />
          <h2 className="font-bold text-[#173B57]">등록된 매뉴얼 자료가 없습니다.</h2>
          <p className="text-sm text-slate-500">장비 매뉴얼 자료는 관리자에게 문의해 주세요.</p>
        </div>
      </div>
    </section>
  );
};
