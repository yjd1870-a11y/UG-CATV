import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { INITIAL_CATV_MANPOWER } from '../data/mockData';
import { authApi, type SignupInput } from '../features/auth/api';
import { cellsApi } from '../features/cells/api';
import { dailyWorkApi } from '../features/daily-work/api';
import { loadBusinessData } from '../features/home/load-business-data';
import { materialsApi } from '../features/materials/api';
import { manpowerApi, type ManpowerEnvelope } from '../features/manpower/api';
import { transfersApi } from '../features/transfers/api';
import { ApiClientError } from '../shared/api/client';
import { canEditCatvManpower } from '../shared/auth/permissions';
import {
  AppView,
  CatvManagementStaff,
  CatvManpowerStatus,
  CatvRegionManpower,
  CellInfo,
  CellPhoto,
  CellWorkHistory,
  DailyWorkCategory,
  DailyWorkRecord,
  MaterialUsageRecord,
  ToastMessage,
  TransferStatus,
  User,
  WorkTransfer,
} from '../types';

interface AppContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  isAuthChecking: boolean;
  isDataLoading: boolean;
  dataError: string | null;
  activeView: AppView;
  selectedCellId: string | null;
  selectedTransferId: string | null;
  cells: CellInfo[];
  transfers: WorkTransfer[];
  dailyRecords: DailyWorkRecord[];
  materialUsage: MaterialUsageRecord[];
  recentCells: string[];
  catvManpower: CatvManpowerStatus;
  toast: ToastMessage | null;
  notificationCount: number;
  login: (username: string, password: string) => Promise<boolean>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  reloadBusinessData: () => Promise<void>;
  searchCells: (query: string) => Promise<void>;
  navigateTo: (view: AppView, params?: { cellId?: string; transferId?: string }) => void;
  selectCell: (cellId: string) => void;
  selectTransfer: (transferId: string) => void;
  updateTransferStatus: (transferId: string, toStatus: TransferStatus, comment: string) => void;
  saveDailyWork: (
    date: string,
    workerName: string,
    team: string,
    counts: Record<DailyWorkCategory, number>,
    memo?: string
  ) => void;
  addMaterialUsage: (record: Omit<MaterialUsageRecord, 'id' | 'createdAt'>) => void;
  addCellPhoto: (cellId: string, photo: Omit<CellPhoto, 'id'>) => void;
  addCellHistory: (cellId: string, history: Omit<CellWorkHistory, 'id'>) => void;
  updateCellHistory: (cellId: string, historyId: string, updates: Partial<CellWorkHistory>) => void;
  deleteCellHistory: (cellId: string, historyId: string) => void;
  addTransferTicket: (ticket: Omit<WorkTransfer, 'id' | 'logs'>) => void;
  updateCatvManpower: (newStatus: CatvManpowerStatus) => Promise<boolean>;
  updateCatvRegion: (regionId: string, updates: Partial<CatvRegionManpower>) => void;
  updateCatvManagement: (updates: Partial<CatvManagementStaff>) => void;
  showToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  hideToast: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const genericLoadError = '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [cells, setCells] = useState<CellInfo[]>([]);
  const [transfers, setTransfers] = useState<WorkTransfer[]>([]);
  const [dailyRecords, setDailyRecords] = useState<DailyWorkRecord[]>([]);
  const [materialUsage, setMaterialUsage] = useState<MaterialUsageRecord[]>([]);
  const [recentCells, setRecentCells] = useState<string[]>(() => {
    const saved = localStorage.getItem('yt_recent_cells');
    return saved ? JSON.parse(saved) : ['OSAN-001', 'SUJI-021', 'PYEONGTAEK-015'];
  });
  const [catvManpower, setCatvManpower] = useState<CatvManpowerStatus>(INITIAL_CATV_MANPOWER);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const activeViewRef = useRef<AppView>('home');
  const mobileHistoryReadyRef = useRef(false);
  const restoringMobileGuardRef = useRef(false);
  const lastMobileBackRef = useRef(0);

  useEffect(() => {
    localStorage.setItem('yt_recent_cells', JSON.stringify(recentCells));
  }, [recentCells]);

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = Date.now().toString();
    setToast({ id, type, message });
    setTimeout(() => setToast((previous) => (previous?.id === id ? null : previous)), 3200);
  }, []);

  const hideToast = () => setToast(null);

  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    const apply = (value: ManpowerEnvelope) => { if (active) setCatvManpower(value.status); };
    const refresh = () => { void manpowerApi.get().then(apply).catch((error) => console.error('CATV manpower sync failed', error)); };
    refresh();
    const source = new EventSource(manpowerApi.eventsUrl(), { withCredentials: true });
    source.addEventListener('manpower', (event) => {
      try { apply(JSON.parse((event as MessageEvent<string>).data) as ManpowerEnvelope); }
      catch (error) { console.error('CATV manpower event was invalid', error); }
    });
    const interval = window.setInterval(refresh, 60_000);
    const handleVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      source.close();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || mobileHistoryReadyRef.current) return;
    const isMobile = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
    if (!isMobile) return;
    mobileHistoryReadyRef.current = true;
    const baseState = { catvApp: true, mobileBase: true, view: 'home' as AppView };
    window.history.replaceState(baseState, '');
    window.history.pushState({ catvApp: true, view: activeViewRef.current }, '');

    const onPopState = (event: PopStateEvent) => {
      if (restoringMobileGuardRef.current) {
        restoringMobileGuardRef.current = false;
        return;
      }
      const state = event.state as { catvApp?: boolean; mobileBase?: boolean; view?: AppView; cellId?: string; transferId?: string } | null;
      if (!state?.catvApp) return;
      if (state.mobileBase && activeViewRef.current === 'home') {
        const now = Date.now();
        if (now - lastMobileBackRef.current <= 2_000) {
          mobileHistoryReadyRef.current = false;
          window.history.back();
          return;
        }
        lastMobileBackRef.current = now;
        showToast('종료하려면 뒤로가기를 한 번 더 누르세요.', 'info');
        restoringMobileGuardRef.current = true;
        window.history.forward();
        return;
      }
      if (state.view) {
        setActiveView(state.view);
        activeViewRef.current = state.view;
        if (state.cellId) setSelectedCellId(state.cellId);
        if (state.transferId) setSelectedTransferId(state.transferId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      mobileHistoryReadyRef.current = false;
    };
  }, [currentUser?.id, showToast]);

  const reloadBusinessData = async () => {
    setIsDataLoading(true);
    setDataError(null);
    try {
      const data = await loadBusinessData();
      setCells(data.cells);
      setTransfers(data.transfers);
      setDailyRecords(data.dailyRecords);
      setMaterialUsage(data.materialUsage);
      setSelectedCellId((current) => current || data.cells[0]?.id || null);
      setSelectedTransferId((current) => current || data.transfers[0]?.id || null);
    } catch (error) {
      console.error(error);
      setDataError(genericLoadError);
      throw error;
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const user = await authApi.me();
        if (!active) return;
        setCurrentUser(user);
        await reloadBusinessData();
      } catch (error) {
        if (!(error instanceof ApiClientError && error.status === 401)) console.error(error);
      } finally {
        if (active) setIsAuthChecking(false);
      }
    };
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const user = await authApi.login(username, password);
    setCurrentUser(user);
    await reloadBusinessData();
    setActiveView('home');
    showToast(`${user.name} (${user.roleLabel}) 로그인되었습니다.`, 'success');
    return true;
  };

  const signup = async (input: SignupInput) => {
    await authApi.signup(input);
    showToast('가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.', 'success');
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setCurrentUser(null);
      setCells([]);
      setTransfers([]);
      setDailyRecords([]);
      setMaterialUsage([]);
      setActiveView('home');
      mobileHistoryReadyRef.current = false;
      showToast('로그아웃되었습니다.', 'info');
    }
  };

  const searchCells = async (query: string) => {
    setIsDataLoading(true);
    setDataError(null);
    try {
      setCells(await cellsApi.search(query));
    } catch (error) {
      console.error(error);
      setDataError(genericLoadError);
    } finally {
      setIsDataLoading(false);
    }
  };

  const navigateTo = (view: AppView, params?: { cellId?: string; transferId?: string }) => {
    if (params?.cellId) setSelectedCellId(params.cellId);
    if (params?.transferId) setSelectedTransferId(params.transferId);
    setActiveView(view);
    activeViewRef.current = view;
    if (mobileHistoryReadyRef.current) {
      window.history.pushState({ catvApp: true, view, cellId: params?.cellId, transferId: params?.transferId }, '');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectCell = (cellId: string) => {
    void (async () => {
      setIsDataLoading(true);
      try {
        const existing = cells.find((cell) => cell.id === cellId || cell.cellName === cellId);
        const detail = await cellsApi.detail(existing?.id || cellId);
        setCells((previous) => {
          const found = previous.some((cell) => cell.id === detail.id);
          return found ? previous.map((cell) => (cell.id === detail.id ? detail : cell)) : [detail, ...previous];
        });
        setRecentCells((previous) => [detail.cellName, ...previous.filter((name) => name !== detail.cellName)].slice(0, 5));
        navigateTo('cell_detail', { cellId: detail.id });
      } catch (error) {
        showToast(error instanceof Error ? error.message : genericLoadError, 'error');
      } finally {
        setIsDataLoading(false);
      }
    })();
  };

  const selectTransfer = (transferId: string) => navigateTo('transfer_detail', { transferId });

  const updateTransferStatus = (transferId: string, toStatus: TransferStatus, comment: string) => {
    void transfersApi.update(transferId, { status: toStatus, comment })
      .then((updated) => {
        setTransfers((previous) => previous.map((transfer) => (transfer.id === transferId ? updated : transfer)));
        showToast(`업무이관 상태가 [${toStatus}](으)로 변경되었습니다.`, 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const saveDailyWork = (
    date: string,
    _workerName: string,
    _team: string,
    counts: Record<DailyWorkCategory, number>,
    memo?: string
  ) => {
    void dailyWorkApi.save({ date, counts, memo })
      .then((saved) => {
        setDailyRecords((previous) => {
          const exists = previous.some((record) => record.id === saved.id);
          return exists ? previous.map((record) => (record.id === saved.id ? saved : record)) : [saved, ...previous];
        });
        showToast('오늘 업무가 DB에 저장되었습니다.', 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const addMaterialUsage = (record: Omit<MaterialUsageRecord, 'id' | 'createdAt'>) => {
    const { workerName: _workerName, ...payload } = record;
    void materialsApi.addUsage(payload)
      .then((saved) => {
        setMaterialUsage((previous) => [saved, ...previous]);
        showToast(`자재사용 [${record.materialName} ${record.quantity}${record.unit}] DB 저장 완료`, 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const addCellPhoto = (cellId: string, photo: Omit<CellPhoto, 'id'>) => {
    void cellsApi.addPhoto(cellId, photo)
      .then(async () => {
        const detail = await cellsApi.detail(cellId);
        setCells((previous) => previous.map((cell) => (cell.id === detail.id ? detail : cell)));
        showToast('현장사진 정보가 DB에 등록되었습니다.', 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const addCellHistory = (cellId: string, historyItem: Omit<CellWorkHistory, 'id'>) => {
    void cellsApi.addHistory(cellId, historyItem)
      .then(async () => {
        const detail = await cellsApi.detail(cellId);
        setCells((previous) => previous.map((cell) => (cell.id === detail.id ? detail : cell)));
        showToast('작업이력이 DB에 기록되었습니다.', 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const updateCellHistory = (cellId: string, historyId: string, updates: Partial<CellWorkHistory>) => {
    void cellsApi.updateHistory(cellId, historyId, updates)
      .then(async () => {
        const detail = await cellsApi.detail(cellId);
        setCells((previous) => previous.map((cell) => (cell.id === detail.id ? detail : cell)));
        showToast('작업이력이 DB에서 수정되었습니다.', 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const deleteCellHistory = (cellId: string, historyId: string) => {
    void cellsApi.deleteHistory(cellId, historyId)
      .then(() => {
        setCells((previous) => previous.map((cell) =>
          cell.id === cellId || cell.cellName === cellId
            ? { ...cell, history: (cell.history || []).filter((history) => history.id !== historyId) }
            : cell
        ));
        showToast('작업이력이 DB에서 삭제되었습니다.', 'info');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const addTransferTicket = (ticket: Omit<WorkTransfer, 'id' | 'logs'>) => {
    void transfersApi.create(ticket)
      .then((created) => {
        setTransfers((previous) => [created, ...previous]);
        showToast(`업무이관 [${ticket.serviceNo}] DB 등록 완료`, 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : genericLoadError, 'error'));
  };

  const updateCatvManpower = async (newStatus: CatvManpowerStatus) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return false;
    }
    try {
      const updated = await manpowerApi.update(newStatus);
      setCatvManpower(updated.status);
      showToast('CATV 인력/차량 현황이 모든 계정에 실시간 반영되었습니다.', 'success');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : genericLoadError, 'error');
      return false;
    }
  };

  const updateCatvRegion = (regionId: string, updates: Partial<CatvRegionManpower>) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return;
    }
    const next = {
      ...catvManpower,
      lastUpdated: new Date().toLocaleString('ko-KR'),
      regions: catvManpower.regions.map((region) => region.id === regionId ? { ...region, ...updates } : region),
    };
    void updateCatvManpower(next);
  };

  const updateCatvManagement = (updates: Partial<CatvManagementStaff>) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return;
    }
    const next = {
      ...catvManpower,
      lastUpdated: new Date().toLocaleString('ko-KR'),
      management: { ...catvManpower.management, ...updates },
    };
    void updateCatvManpower(next);
  };

  const notificationCount = transfers.filter((transfer) => transfer.status === '대기' || transfer.status === '작업중').length;

  return (
    <AppContext.Provider value={{
      currentUser,
      isAuthenticated: Boolean(currentUser),
      isAuthChecking,
      isDataLoading,
      dataError,
      activeView,
      selectedCellId,
      selectedTransferId,
      cells,
      transfers,
      dailyRecords,
      materialUsage,
      recentCells,
      catvManpower,
      toast,
      notificationCount,
      login,
      signup,
      logout,
      reloadBusinessData,
      searchCells,
      navigateTo,
      selectCell,
      selectTransfer,
      updateTransferStatus,
      saveDailyWork,
      addMaterialUsage,
      addCellPhoto,
      addCellHistory,
      updateCellHistory,
      deleteCellHistory,
      addTransferTicket,
      updateCatvManpower,
      updateCatvRegion,
      updateCatvManagement,
      showToast,
      hideToast,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
