import React, { lazy, Suspense } from 'react';
import { HomeDashboard } from '../components/home/HomeDashboard';
import { useApp } from '../context/AppContext';

const CellList = lazy(() => import('../features/cells/views').then((module) => ({ default: module.CellList })));
const CellDetail = lazy(() => import('../features/cells/views').then((module) => ({ default: module.CellDetail })));
const TransferList = lazy(() => import('../features/transfers/views').then((module) => ({ default: module.TransferList })));
const TransferAnalytics = lazy(() => import('../features/transfers/views').then((module) => ({ default: module.TransferAnalytics })));
const TransferDetail = lazy(() => import('../features/transfers/views').then((module) => ({ default: module.TransferDetail })));
const DailyWorkView = lazy(() => import('../features/daily-work/view').then((module) => ({ default: module.DailyWorkView })));
const MaterialView = lazy(() => import('../features/materials/view').then((module) => ({ default: module.MaterialView })));
const AdminUsersView = lazy(() => import('../features/admin/view').then((module) => ({ default: module.AdminUsersView })));

const ViewLoading = () => (
  <div className="flex min-h-48 items-center justify-center text-sm font-semibold text-[#173B57]" role="status">
    화면을 불러오는 중입니다...
  </div>
);

export const ActiveView: React.FC = () => {
  const { activeView } = useApp();

  const renderView = () => {
    switch (activeView) {
      case 'home':
        return <HomeDashboard />;
      case 'cell_list':
        return <CellList />;
      case 'cell_detail':
        return <CellDetail />;
      case 'transfer_list':
        return <TransferList />;
      case 'transfer_analytics':
        return <TransferAnalytics />;
      case 'transfer_detail':
        return <TransferDetail />;
      case 'daily_work':
        return <DailyWorkView />;
      case 'material_list':
      case 'material_register':
        return <MaterialView />;
      case 'admin_users':
        return <AdminUsersView />;
      default:
        return <HomeDashboard />;
    }
  };

  return <Suspense fallback={<ViewLoading />}>{renderView()}</Suspense>;
};
