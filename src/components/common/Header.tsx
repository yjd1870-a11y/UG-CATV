import React, { useState } from 'react';
import {
  Bell,
  Database,
  LogOut,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from './StatusBadge';
import telecomBg from '../../assets/images/telecom_network_bg_1786338007517.jpg';

export const Header: React.FC = () => {
  const {
    currentUser,
    activeView,
    navigateTo,
    logout,
    transfers,
    notificationCount,
    selectTransfer,
  } = useApp();

  const [showNotificationDrawer, setShowNotificationDrawer] = useState(false);

  const pendingTransfers = transfers.filter(
    (t) => t.status === '대기' || t.status === '작업중'
  );

  return (
    <>
      <header
        id="app-header"
        className="sticky top-0 z-30 flex items-center justify-between overflow-hidden bg-[#173B57] px-4 py-3 text-white shadow-md transition-all sm:px-6 sm:py-3.5 lg:h-[60px] lg:py-0"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(23, 59, 87, 0.93) 0%, rgba(23, 59, 87, 0.85) 60%, rgba(23, 59, 87, 0.92) 100%), url(${telecomBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'right center',
        }}
      >
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
          {/* Brand Logo & Name */}
          <button
            id="header-brand-btn"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-2.5 text-left focus:outline-none focus:ring-2 focus:ring-[#F28C28] rounded-xl p-1 transition cursor-pointer"
          >
            <div className="w-8 h-8 bg-[#F28C28] rounded-lg flex items-center justify-center font-black text-lg text-white shadow-sm">
              U
            </div>
            <div>
              <h1 className="text-base sm:text-xl font-bold tracking-tight text-white flex items-baseline">
                유지텔레컴
                <span className="ml-1.5 hidden text-sm font-normal opacity-80 md:inline">
                  CATV 업무관리
                </span>
              </h1>
            </div>
          </button>

          {/* Right Action: Login Info, Notifications & Logout */}
          {currentUser && (
            <div className="flex items-center gap-1.5 sm:gap-3">
              {/* Logged-in User Information */}
              <div
                id="header-login-info"
                className="min-w-0 border-r border-white/20 pr-2 text-right sm:min-w-36 sm:pr-4"
              >
                <p className="truncate text-[10px] leading-tight text-slate-300 sm:text-xs">
                  {currentUser.team}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-bold leading-tight text-white sm:text-sm">
                  {currentUser.name} {currentUser.roleLabel}
                </p>
              </div>

              {currentUser.role === 'admin' ? (
                <button
                  type="button"
                  onClick={() => navigateTo('admin_users')}
                  aria-label="DB 관리"
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-blue-200/30 bg-blue-100/10 px-2 text-xs font-bold text-blue-100 transition hover:bg-blue-100/20 lg:px-2.5"
                >
                  <Database className="h-4 w-4" />
                  <span className="hidden lg:inline">DB 관리</span>
                </button>
              ) : null}

              {/* Notification Bell (Quick Action) */}
              <button
                id="header-notification-btn"
                onClick={() => setShowNotificationDrawer(true)}
                className="relative p-2 text-slate-200 hover:text-white hover:bg-white/10 rounded-full transition focus:outline-none cursor-pointer"
                aria-label="알림"
              >
                <Bell className="w-5 h-5" />
                {notificationCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-[#F28C28] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                    {notificationCount}
                  </span>
                )}
              </button>

              {/* Direct Logout Button */}
              <button
                id="header-logout-btn"
                type="button"
                onClick={logout}
                className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2.5 text-xs font-bold text-white transition hover:border-white/40 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#F28C28] sm:h-10 sm:px-3"
                aria-label="로그아웃"
              >
                <LogOut className="h-4 w-4" />
                <span>로그아웃</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Notifications Slide-over Drawer */}
      {showNotificationDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setShowNotificationDrawer(false)}
          />
          <div
            id="notification-drawer"
            className="relative w-full max-w-sm bg-white h-full shadow-2xl z-10 flex flex-col animate-in slide-in-from-right duration-200"
          >
            {/* Drawer Header */}
            <div
              className="px-4 py-3.5 text-white flex items-center justify-between relative overflow-hidden bg-[#173B57]"
              style={{
                backgroundImage: `linear-gradient(90deg, rgba(23, 59, 87, 0.92) 0%, rgba(23, 59, 87, 0.85) 100%), url(${telecomBg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-400" />
                <span className="font-bold text-base">현장 미처리 업무 알림</span>
                <span className="text-xs bg-[#F28C28] text-white px-2 py-0.5 rounded-full font-bold">
                  {pendingTransfers.length}
                </span>
              </div>
              <button
                onClick={() => setShowNotificationDrawer(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {pendingTransfers.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">
                  <ShieldCheck className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
                  현재 대기 중인 긴급 업무이관이 없습니다.
                </div>
              ) : (
                pendingTransfers.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setShowNotificationDrawer(false);
                      selectTransfer(item.id);
                    }}
                    className="p-3 bg-slate-50 hover:bg-blue-50/60 border border-slate-200 rounded-xl cursor-pointer transition shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs text-[#173B57]">
                        {item.serviceNo}
                      </span>
                      <StatusBadge status={item.status} size="sm" />
                    </div>
                    <div className="text-xs font-semibold text-[#1F2937] mb-1 line-clamp-1">
                      {item.transferReason}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center justify-between">
                      <span>CELL: {item.cellName}</span>
                      <span>{item.requestDate}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => {
                  setShowNotificationDrawer(false);
                  navigateTo('transfer_list');
                }}
                className="w-full py-2.5 bg-[#2878B5] hover:bg-[#1f6396] text-white text-xs font-bold rounded-lg transition"
              >
                업무이관 전체 목록 보기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
