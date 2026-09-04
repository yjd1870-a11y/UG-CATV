import React from 'react';
import { useApp } from '../../context/AppContext';
import { primaryNavigationItems } from './primary-navigation';

export const DesktopSidebar: React.FC = () => {
  const { activeView, navigateTo, notificationCount } = useApp();

  return (
    <aside
      id="desktop-navigation-sidebar"
      aria-label="주요 업무 메뉴"
      className="fixed bottom-0 left-0 top-[60px] z-20 hidden w-[210px] flex-col border-r border-slate-200 bg-white/95 shadow-[5px_0_18px_rgba(15,35,51,0.06)] backdrop-blur-md lg:flex"
    >
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
        {primaryNavigationItems(notificationCount).map((item) => {
          const active = item.matchViews.includes(activeView);
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigateTo(item.key)}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition ${
                active
                  ? 'bg-blue-50 font-extrabold text-[#2878B5] shadow-sm'
                  : 'font-bold text-slate-500 hover:bg-slate-50 hover:text-[#173B57]'
              }`}
            >
              {active ? <span className="absolute -left-3 h-8 w-1 rounded-r-full bg-[#2878B5]" /> : null}
              <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-[#2878B5]' : 'text-slate-400 group-hover:text-[#2878B5]'}`} />
              <span>{item.label}</span>
              {item.badgeCount !== undefined && item.badgeCount > 0 ? (
                <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-[#F28C28] px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm">
                  {item.badgeCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-100 px-4 py-4 text-[10px] font-semibold leading-relaxed text-slate-400">
        CATV/HFC 현장업무 관리
      </div>
    </aside>
  );
};
