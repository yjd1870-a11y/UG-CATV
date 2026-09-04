import type React from 'react';
import { ArrowRightLeft, Boxes, ClipboardCheck, Home, Radio } from 'lucide-react';
import type { AppView } from '../../types';

export type PrimaryNavItem = {
  key: AppView;
  matchViews: AppView[];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
};

export const primaryNavigationItems = (notificationCount: number): PrimaryNavItem[] => [
  { key: 'home', matchViews: ['home'], label: '홈', icon: Home },
  { key: 'cell_list', matchViews: ['cell_list', 'cell_detail'], label: 'CELL', icon: Radio },
  {
    key: 'transfer_list',
    matchViews: ['transfer_list', 'transfer_analytics', 'transfer_detail'],
    label: '업무이관',
    icon: ArrowRightLeft,
    badgeCount: notificationCount,
  },
  { key: 'daily_work', matchViews: ['daily_work', 'daily_lookup'], label: '일일업무', icon: ClipboardCheck },
  { key: 'material_list', matchViews: ['material_list', 'material_register'], label: '자재', icon: Boxes },
];
