export type UserRole = 'manager' | 'public_official' | 'team_leader' | 'admin';

export interface HomeNotice {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdByName?: string;
  updatedByName?: string;
}

export interface User {
  id: string;
  username?: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  team: string;
  phone: string;
  company: string;
  regionId?: string;
  regionName?: string;
  status?: 'pending' | 'active' | 'disabled';
}

export type CellStatus = '정상' | '점검필요' | '노이즈발생' | '장애';

export interface CellPhoto {
  id: string;
  title: string;
  category: '전주작업' | '분기기함' | '증폭기' | '광노드' | '국사설비';
  date: string;
  author: string;
  url: string;
  description: string;
}

export interface CellWorkHistory {
  id: string;
  title?: string;
  type: string;
  date: string;
  worker: string;
  summary: string;
  status?: '완료' | '진행중';
  photos?: string[]; // Attached photo URLs (up to 3)
}

export interface StationLineInfo {
  item: string;
  node: string;
  lineNo: string;
}

export interface StationTransceiverInfo {
  item: string;
  rack: string;
  shelf: string;
  port: string;
  model: string;
}

export interface StationDetails {
  descriptionCode: string;
  stationName: string;
  stationAddress: string;
  lineInfoList: StationLineInfo[];
  transceiverList: StationTransceiverInfo[];
}

export interface HfcOnuInfo {
  location: string;
  manufacturer: string;
  modelName: string;
  divisionType: string;
  cellConfig: string;
}

export interface HfcUpsInfo {
  location: string;
  manufacturer: string;
  modelName: string;
}

export interface HfcDetails {
  onu: HfcOnuInfo;
  ups: HfcUpsInfo;
}

export interface CellInfo {
  id: string;
  cellName: string;
  region: string;
  lineCode: string;
  stationInfo: string;
  address: string;
  status: CellStatus;
  opticalNode: string;
  trunkAmpCount: number;
  extenderCount: number;
  tapCount: number;
  subscriberCount: number;
  responsibleTeam: string;
  remarks: string;
  stationDetails?: StationDetails;
  hfcDetails?: HfcDetails;
  diagramData: {
    opticalRxLevel: string;
    rfOutLevel: string;
    returnLevel: string;
    freqBand: string;
    tbaList: Array<{
      id: string;
      name: string;
      location: string;
      inLevel: string;
      outLevel: string;
      slope: string;
      status: string;
    }>;
    tapList: Array<{
      id: string;
      name: string;
      type: string;
      value: string;
      portCount: number;
      location: string;
    }>;
  };
  floorPlanData: {
    rackNumber: string;
    odfPosition: string;
    transmitter: string;
    edfa: string;
    cmtsPort: string;
    notes: string;
  };
  photos: CellPhoto[];
  history: CellWorkHistory[];
}

export type TransferStatus = '미완료' | '현장처리' | '완료' | '대기' | '작업중' | '업무이관';
export type TransferWorkflowStatus = 'registered' | 'field_processed' | 'completed';
export type TransferOcrStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type MediaType = 'HFC' | 'FTTH' | 'RF' | '광복합' | 'CABLE';

export interface TransferLog {
  timestamp: string;
  author: string;
  fromStatus?: TransferStatus;
  toStatus: TransferStatus;
  comment: string;
}

export interface WorkTransfer {
  id: string;
  serviceNo: string;
  contractor: string;
  requestDate: string;
  status: TransferStatus;
  mediaType: MediaType;
  serviceTech: string;
  cellName: string;
  location: string;
  transferReason: string;
  preActionNotes: string;
  requestDetails: string;
  requesterName: string;
  branchName?: string;
  inspectionCompany?: string;
  inspectionRequestedDate?: string;
  customerAddress?: string;
  handoverReason?: string;
  tapRnLocation?: string;
  poleNumber?: string;
  leadInLength?: string;
  inspectionRequestDetails?: string;
  fieldActionSummary?: string;
  createdAt?: string;
  workflowStatus?: TransferWorkflowStatus;
  regionId?: string;
  regionName?: string;
  isUrgent?: boolean;
  ocrStatus?: TransferOcrStatus;
  evidencePhotoCount?: number;
  evidencePhotosDeletedAt?: string;
  fieldProcessedAt?: string;
  fieldProcessedBy?: string;
  fieldProcessedByName?: string;
  finalCompletedBy?: string;
  finalCompletedByName?: string;
  attachments?: WorkTransferAttachment[];
  fieldActions?: WorkTransferFieldAction[];
  workerName?: string;
  completedDate?: string;
  logs: TransferLog[];
}

export interface WorkTransferAttachment {
  id: string;
  attachmentType: 'request_photo' | 'field_photo';
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy?: string;
  createdAt: string;
  url: string;
}

export interface WorkTransferFieldAction {
  id: string;
  actionText: string;
  processedBy?: string;
  processedByName: string;
  processedAt: string;
  createdAt: string;
}

export type DailyWorkCategory =
  | '한전순시적출'
  | '합동정비'
  | '정기점검'
  | '불량셀'
  | '노이즈'
  | 'SWING'
  | '민원'
  | '장애처리'
  | '업무지원'
  | '기타';

export const DAILY_WORK_CATEGORIES: DailyWorkCategory[] = [
  '장애처리',
  '불량셀',
  '노이즈',
  'SWING',
  '정기점검',
  '민원',
  '합동정비',
  '한전순시적출',
  '업무지원',
  '기타',
];

export interface WorkCategory {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface DailyWorkRegion {
  id: string;
  name: string;
  sortOrder: number;
}

export interface DailyWorkUserOption {
  id: string;
  name: string;
  department: string;
  regionId: string;
  role: string;
}

export interface DailyWorkMeta {
  today: string;
  categories: WorkCategory[];
  regions: DailyWorkRegion[];
  users: DailyWorkUserOption[];
}

export interface DailyWorkRecord {
  id: string;
  date: string;
  workDate?: string;
  userId?: string;
  workerName: string;
  team: string;
  regionId?: string;
  regionName?: string;
  counts: Record<string, number>;
  total?: number;
  memo?: string;
  createdAt?: string;
  updatedAt: string;
  canEdit?: boolean;
}

export interface DailyWorkAggregateRow {
  key: string;
  id?: string;
  date: string;
  workDate: string;
  userId?: string;
  workerName?: string;
  regionId?: string;
  regionName?: string;
  counts: Record<string, number>;
  total: number;
  memo?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyWorkAggregate {
  categories: WorkCategory[];
  rows: DailyWorkAggregateRow[];
  categoryTotals: Record<string, number>;
  grandTotal: number;
  from?: string;
  to?: string;
}

export type MaterialCategory =
  | '동축케이블'
  | '광케이블'
  | 'Connector'
  | 'TAP'
  | 'Splitter'
  | 'AMP'
  | '광모듈'
  | '기타';

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  '동축케이블',
  '광케이블',
  'Connector',
  'TAP',
  'Splitter',
  'AMP',
  '광모듈',
  '기타',
];

export interface MaterialUsageRecord {
  id: string;
  workDate: string;
  workerName: string;
  cellName: string;
  materialName: MaterialCategory;
  spec: string;
  quantity: number;
  unit: string;
  purpose: string;
  workDetails: string;
  remarks?: string;
  createdAt: string;
}

export type AppView =
  | 'login'
  | 'home'
  | 'cell_list'
  | 'cell_detail'
  | 'transfer_list'
  | 'transfer_analytics'
  | 'transfer_detail'
  | 'daily_work'
  | 'daily_lookup'
  | 'material_list'
  | 'material_register'
  | 'admin_users';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
  duration?: number;
}

export interface CatvRegionManpower {
  id: string;
  regionName: string; // '평택안성' | '용인' | '수원' | '오산화성'
  headcount: number; // 인원 (명)
  aerialVehicles: number; // 고소차량 (대)
  passengerVehicles: number; // 승용차량 (대)
  baseLocation?: string;
}

export interface CatvManagementStaff {
  director: number; // 소장 (1명)
  generalManager: number; // 총괄팀장 (1명)
  adminTeam: number; // 행정팀 (4명)
}

export interface CatvManpowerStatus {
  regions: CatvRegionManpower[];
  management: CatvManagementStaff;
  lastUpdated: string;
}

export interface DedicatedLineInfo {
  id: string;
  lineCode: string;
  customerName: string;
  region: string;
  stationInfo: string;
  address: string;
  speed: string;
  opticalCore: string;
  status: '개통운영' | '점검필요' | '공사중' | '해지대기';
  responsibleTeam: string;
  remarks?: string;
}

export interface CatvCell {
  id: string;
  keyNumber: string;
  cellName: string;
  stationName: string;
  stationAddress: string;
  otxMain: string;
  otxLine: string;
  orxMain: string;
  orxLine: string;
  backup: string;
  backupLine: string;
  otxRack: string;
  otxShelf: string;
  otxPort: string;
  otxModel: string;
  orxRack: string;
  orxShelf: string;
  orxPort: string;
  orxModel: string;
  onuLocation: string;
  onuMaker: string;
  onuModel: string;
  onuSplit: string;
  onuCellConfig: string;
  upsLocation: string;
  upsMaker: string;
  upsModel: string;
  remarks: string;
  status?: string;
  history?: CellWorkHistory[];
}

export interface CatvB2CLine {
  id: string;
  stationName: string;
  stationAddress: string;
  serviceName: string;
  b2cName: string;
  node: string;
  line: string;
  core: string;
  serviceLineNumber: string;
  serviceCategory: string;
  serviceType: string;
  sheetName: string;
  rowNumber: number | null;
  memo: string;
  searchValues: string[];
  sourceFile: string;
}

export interface CatvFloorPlanResult {
  floorPlan: {
    id: string;
    stationName: string;
    planOrder: 1 | 2 | 3;
    displayName: string;
    fileName: string;
    imageUrl: string;
    width: number | null;
    height: number | null;
  };
  target: {
    label: string;
    xRatio: number;
    yRatio: number;
    equipmentType: string;
  } | null;
  requestedTarget: string;
  plans: Array<{
    id: string;
    planOrder: 1 | 2 | 3;
    displayName: string;
    fileName: string;
    imageUrl: string;
  }>;
  matches: Array<{
    floorPlanId: string;
    planOrder: 1 | 2 | 3;
    displayName: string;
    label: string;
    xRatio: number;
    yRatio: number;
    equipmentType: string;
  }>;
}

export interface StraightMapSearchResult {
  id: string;
  mapId: string;
  mapName: string;
  mapVersion: number;
  mapStatus: 'ACTIVE' | 'PROCESSING';
  label: string;
  objectType: string;
  xRatio: number;
  yRatio: number;
  pageIndex: number;
  pageXPoints: number;
  pageYPoints: number;
  worldXPoints: number;
  worldYPoints: number;
  widthPoints: number;
  heightPoints: number;
  matchRank: number;
}

export interface StraightMapMetadata {
  mapId: string;
  mapName: string;
  version: number;
  status: 'ACTIVE';
  renderMode: 'pdf-viewport-v3';
  worldWidthPoints: number;
  worldHeightPoints: number;
  pageCount: number;
  contentBounds: { xPoints: number; yPoints: number; widthPoints: number; heightPoints: number };
  pagePlacements: Array<{ pageIndex: number; xPoints: number; yPoints: number; widthPoints: number; heightPoints: number }>;
  pdfUrl: string;
  pdfRequiresCredentials: boolean;
}
