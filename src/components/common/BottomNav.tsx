import React from 'react';
import {
  ArrowRightLeft,
  Boxes,
  ClipboardCheck,
  Home,
  Radio,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AppView } from '../../types';

interface NavItem {
  key: AppView;
  matchViews: AppView[];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

export const BottomNav: React.FC = () => {
  const { activeView, navigateTo, notificationCount } = useApp();

  const navItems: NavItem[] = [
    {
      key: 'home',
      matchViews: ['home'],
      label: '홈',
      icon: Home,
    },
    {
      key: 'cell_list',
      matchViews: ['cell_list', 'cell_detail'],
      label: 'CELL',
      icon: Radio,
    },
    {
      key: 'transfer_list',
      matchViews: ['transfer_list', 'transfer_analytics', 'transfer_detail'],
      label: '업무이관',
      icon: ArrowRightLeft,
      badgeCount: notificationCount,
    },
    {
      key: 'daily_work',
      matchViews: ['daily_work', 'daily_lookup'],
      label: '일일업무',
      icon: ClipboardCheck,
    },
    {
      key: 'material_list',
      matchViews: ['material_list'],
      label: '자재',
      icon: Boxes,
    },
  ];

  return (
    <nav
      id="bottom-navigation-bar"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E5E7EB] shadow-[0_-2px_10px_rgba(0,0,0,0.04)] pb-safe"
    >
      <div className="max-w-md mx-auto grid grid-cols-5 h-[68px] sm:h-[76px] px-2">
        {navItems.map((item) => {
          const isActive = item.matchViews.includes(activeView);
          const Icon = item.icon;

          return (
            <button
              key={item.key}
              id={`bottom-nav-${item.key}`}
              onClick={() => navigateTo(item.key)}
              className={`relative flex flex-col items-center justify-center h-full transition-all focus:outline-none select-none cursor-pointer active:scale-95 ${
                isActive
                  ? 'text-[#2878B5]'
                  : 'text-[#9CA3AF] hover:text-[#173B57]'
              }`}
            >
              {/* Active Indicator Top Bar */}
              {isActive && (
                <span className="absolute top-0 w-8 h-1 bg-[#2878B5] rounded-full" />
              )}

              {/* Icon Container with Badge */}
              <div className="relative mb-0.5">
                <div
                  className={`p-1 rounded-xl transition-transform ${
                    isActive ? 'scale-110 text-[#2878B5]' : ''
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 bg-[#F28C28] text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-xs">
                    {item.badgeCount}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={`text-[10px] sm:text-[11px] leading-tight tracking-tight whitespace-nowrap ${
                  isActive ? 'font-bold text-[#2878B5]' : 'font-semibold text-[#9CA3AF]'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
