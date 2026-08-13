import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { INITIAL_CATV_MANPOWER } from '../data/mockData';
import { authApi, type SignupInput } from '../features/auth/api';
import { cellsApi } from '../features/cells/api';
import { dailyWorkApi } from '../features/daily-work/api';
import { loadBusinessData } from '../features/home/load-business-data';
import { materialsApi } from '../features/materials/api';
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
  updateCatvManpower: (newStatus: CatvManpowerStatus) => void;
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
  const [catvManpower, setCatvManpower] = useState<CatvManpowerStatus>(() => {
    const saved = localStorage.getItem('yt_catv_manpower');
    return saved ? JSON.parse(saved) : INITIAL_CATV_MANPOWER;
  });
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    localStorage.setItem('yt_recent_cells', JSON.stringify(recentCells));
  }, [recentCells]);

  useEffect(() => {
    localStorage.setItem('yt_catv_manpower', JSON.stringify(catvManpower));
  }, [catvManpower]);

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = Date.now().toString();
    setToast({ id, type, message });
    setTimeout(() => setToast((previous) => (previous?.id === id ? null : previous)), 3200);
  }, []);

  const hideToast = () => setToast(null);

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

  const updateCatvManpower = (newStatus: CatvManpowerStatus) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return;
    }
    setCatvManpower(newStatus);
    showToast('CATV 인력/차량 현황이 업데이트되었습니다.', 'success');
  };

  const updateCatvRegion = (regionId: string, updates: Partial<CatvRegionManpower>) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return;
    }
    setCatvManpower((previous) => ({
      ...previous,
      lastUpdated: new Date().toLocaleString('ko-KR'),
      regions: previous.regions.map((region) => region.id === regionId ? { ...region, ...updates } : region),
    }));
    showToast('거점 인력현황이 수정되었습니다.', 'success');
  };

  const updateCatvManagement = (updates: Partial<CatvManagementStaff>) => {
    if (!canEditCatvManpower(currentUser?.role)) {
      showToast('매니져는 CATV 인력현황을 수정할 수 없습니다.', 'error');
      return;
    }
    setCatvManpower((previous) => ({
      ...previous,
      lastUpdated: new Date().toLocaleString('ko-KR'),
      management: { ...previous.management, ...updates },
    }));
    showToast('관리인력 현황이 수정되었습니다.', 'success');
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
