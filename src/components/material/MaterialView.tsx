import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Filter,
  FilterX,
  Images,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  compressInventoryPhoto,
  inventoryApi,
  type FieldBatchTransactionInput,
  type FieldBalance,
  type FieldMaterialModel,
  type FieldTransactionUpdateInput,
  type FieldIssueDetail,
  type FieldStatisticFilters,
  type FieldStatisticMeta,
  type FieldUsageItemStatistic,
  type FieldUsageStatistics,
  type InventoryBootstrap,
  type InventoryTransaction,
  type InventoryTransactionInput,
  type SpareBalance,
  type SpareBatchTransactionInput,
  type SpareModel,
} from "../../features/materials/api";

type Domain = "FIELD" | "STATION";
type InventoryPanel = "STOCK" | "LEDGER" | "ANALYTICS" | "MASTER";
type LedgerSearchField = "ALL" | "REGION" | "WORKER" | "CATEGORY" | "MODEL" | "TYPE";
const fieldTypes = [
  ["RECEIPT", "입고"],
  ["FIELD_USE", "현장사용"],
  ["OTHER_COMPANY_ISSUE", "타사 분출"],
  ["HS_ISSUE", "H&S 분출"],
  ["RECOVERED_BAD", "불량자재 회수"],
  ["REPAIR_OUT", "불량자재 수리출고"],
  ["DISPOSAL", "불량자재 폐기"],
  ["ADJUSTMENT", "재고조정"],
] as const;
const hsIssueLocations = ["용인남부", "용인북부", "평택", "수원동부", "수원서부", "화성"] as const;
const formatStockQuantity = (value: number | string) => {
  const quantity = Number(value);
  return Math.abs(quantity) < 0.000001 ? "-" : quantity.toLocaleString();
};
const stationTypes = [
  ["RECEIPT", "입고"],
  ["USE", "사용"],
  ["RECOVERED_DEFECTIVE", "불량품 회수"],
  ["DEFECT_CONVERSION", "불량전환"],
  ["REPAIR_OUT", "수리출고"],
  ["REPAIR_COMPLETE", "수리완료"],
  ["REPAIR_UNREPAIRABLE", "수리불가"],
  ["DISPOSAL", "폐기"],
  ["TRANSFER", "국사 간 이동"],
  ["OPENING", "기준재고"],
  ["ADJUSTMENT", "재고조정"],
] as const;
const managerFieldTypes = new Set([
  "FIELD_USE",
  "RECOVERED_GOOD",
  "RECOVERED_BAD",
]);
const managerStationTypes = new Set(["USE", "DEFECT_CONVERSION", "RECOVERED_DEFECTIVE"]);
const badFieldStockTypes = new Set(["RECOVERED_BAD", "REPAIR_OUT", "DISPOSAL"]);
const typeLabels: Record<string, string> = Object.fromEntries([
  ...fieldTypes,
  ...stationTypes,
]);
const fieldEditTypes = [
  ["OPENING", "기준재고"],
  ["RECOVERED_GOOD", "정상자재 회수"],
  ...fieldTypes,
] as const;
const stateLabels: Record<string, string> = {
  NORMAL: "정상",
  BAD: "불량",
  NEW: "신품",
  SERVICEABLE: "양품",
  DEFECTIVE: "불량",
  IN_REPAIR: "수리중",
};
const today = () => new Date().toISOString().slice(0, 10);
const currentMonthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${monthText}-01`,
    end: `${year}-${monthText}-${String(lastDay).padStart(2, "0")}`,
  };
};
const requestKey = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const importDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value || "").trim();
  const matched = text.match(/(20\d{2})[^0-9]?(\d{1,2})[^0-9]?(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  return "";
};
const positiveNumber = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const nonNegativeNumber = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const MetricCard = ({
  label,
  value,
  detail,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "orange" | "red" | "slate";
}) => {
  const styles = {
    blue: "border-blue-100 bg-blue-50/70 text-[#2878B5]",
    orange: "border-orange-100 bg-orange-50/70 text-[#D97706]",
    red: "border-red-100 bg-red-50/70 text-red-600",
    slate: "border-slate-200 bg-white text-[#173B57]",
  };
  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <div className="text-xs font-bold opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
};

export const MaterialView: React.FC = () => {
  const { activeView, navigateTo, currentUser } = useApp();
  const domain: Domain = activeView === "station_spares" ? "STATION" : "FIELD";
  const [data, setData] = useState<InventoryBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activePanel, setActivePanel] = useState<InventoryPanel>("STOCK");
  const [stockQuery, setStockQuery] = useState("");
  const [ledgerQueryText, setLedgerQueryText] = useState("");
  const [ledgerSearchField, setLedgerSearchField] = useState<LedgerSearchField>("ALL");
  const [ledgerStartDate, setLedgerStartDate] = useState(() => currentMonthRange().start);
  const [ledgerEndDate, setLedgerEndDate] = useState(() => currentMonthRange().end);
  const [issueOnly, setIssueOnly] = useState(false);
  const [region, setRegion] = useState("전체");
  const [stationFilter, setStationFilter] = useState("전체");
  const [manufacturerFilter, setManufacturerFilter] = useState("전체");
  const [itemTypeFilter, setItemTypeFilter] = useState("전체");
  const [inStockOnly, setInStockOnly] = useState(true);
  const [showTransaction, setShowTransaction] = useState(false);
  const [showFieldModel, setShowFieldModel] = useState(false);
  const [showSpareModel, setShowSpareModel] = useState(false);
  const [editingFieldModel, setEditingFieldModel] = useState<FieldMaterialModel | null>(null);
  const [editingSpareModel, setEditingSpareModel] = useState<SpareModel | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<InventoryTransaction | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const hsImportRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await inventoryApi.bootstrap());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "자재관리 자료를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setActivePanel("STOCK");
    setStockQuery("");
    setLedgerQueryText("");
    setRegion("전체");
    setStationFilter("전체");
    setManufacturerFilter("전체");
    setItemTypeFilter("전체");
  }, [domain]);
  const fieldRows = useMemo(
    () =>
      (data?.fieldBalances || []).filter((row) => {
        const key = stockQuery.trim().toLowerCase();
        return (
          !key ||
          [row.categoryName, row.modelName].some((value) =>
            value.toLowerCase().includes(key),
          )
        );
      }),
    [data, stockQuery],
  );
  const stationRows = useMemo(
    () =>
      (data?.stationBalances || []).filter((row) => {
        const key = stockQuery.trim().toLowerCase();
        const has =
          row.newQuantity +
            row.serviceableQuantity +
            row.defectiveQuantity +
            row.inRepairQuantity !==
          0;
        return (
          (region === "전체" || row.regionName === region) &&
          (stationFilter === "전체" || row.stationId === stationFilter) &&
          (manufacturerFilter === "전체" || row.manufacturer === manufacturerFilter) &&
          (itemTypeFilter === "전체" || row.itemType === itemTypeFilter) &&
          (!inStockOnly || has) &&
          (!key ||
            [
              row.stationName,
              row.manufacturer,
              row.itemType,
              row.modelName,
            ].some((value) => value.toLowerCase().includes(key)))
        );
      }),
    [data, stockQuery, region, stationFilter, manufacturerFilter, itemTypeFilter, inStockOnly],
  );
  const stationOptions = useMemo(
    () => (data?.stations || []).filter((item) => item.active && (region === "전체" || item.regionName === region)),
    [data, region],
  );
  const filteredStationCount = stationFilter === "전체"
    ? stationOptions.length
    : stationOptions.some((item) => item.id === stationFilter) ? 1 : 0;
  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const exportPeriod = { start: `${today().slice(0, 7)}-01`, end: today() };
  const handleExport = async (
    kind: "official" | "photos" | "hs" | "station",
  ) => {
    setBusy(true);
    setError("");
    try {
      if (kind === "official")
        await inventoryApi.downloadFieldOfficial(Number(today().slice(0, 4)));
      if (kind === "photos")
        await inventoryApi.downloadFieldPhotos(
          exportPeriod.start,
          exportPeriod.end,
        );
      if (kind === "hs")
        await inventoryApi.downloadHs();
      if (kind === "station") await inventoryApi.downloadStation(today());
      setNotice("Excel 파일을 생성했습니다.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Excel 파일을 만들지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const handleImport = async (file: File, importKind: "official" | "hs" | "station") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const XLSX = await import("@e965/xlsx");
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, {
        type: "array",
        cellDates: true,
      });
      const sheetMatrix = (sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];
        const end = XLSX.utils.decode_range(sheet["!ref"] || "A1").e;
        return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          raw: true,
          range: { s: { r: 0, c: 0 }, e: end },
        });
      };
      if (domain === "FIELD") {
        if (importKind === "hs") {
          const rows: Array<Record<string,unknown>>=[];
          for (const sheetName of workbook.SheetNames) {
            const matrix=sheetMatrix(sheetName);
            const headerIndex=matrix.findIndex((row)=>
              String(row[1]||"").trim()==="사업자"&&
              String(row[4]||"").trim()==="모델"&&
              String(row[5]||"").trim()==="수량"&&
              String(row[7]||"").trim()==="날짜"
            );
            if(headerIndex<0) continue;
            matrix.slice(headerIndex+1).forEach((row,index)=>{
              const effectiveDate=importDate(row[7]);
              const categoryName=String(row[3]||"").trim();
              const modelName=String(row[4]||"").trim();
              const quantity=positiveNumber(row[5]);
              if(!effectiveDate||!categoryName||!modelName||!quantity) return;
              const regionName=String(row[2]||"").trim();
              rows.push({sheetName,rowNumber:headerIndex+index+2,transactionType:"HS_ISSUE",effectiveDate,categoryName,modelName,quantity,address:regionName,workCategory:"H&S 분출",workDetails:String(row[8]||"").trim(),companyName:String(row[1]||"").trim()||"H&S",unit:"EA"});
            });
          }
          if(!rows.length) throw new Error("H&S 분출내역 형식의 등록 가능한 데이터가 없습니다.");
          const digest=await crypto.subtle.digest("SHA-256",fileBuffer);
          const sourceHash=Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
          const result=await inventoryApi.importOfficialField({sourceFile:file.name,sourceHash,rows});
          setNotice(`H&S 분출내역 ${result.inserted}건을 등록했습니다.${result.skipped ? ` 동일 자료 ${result.skipped}건은 제외했습니다.` : ""}`);
          await load();
          return;
        }
        const rows: Array<Record<string, unknown>> = [];
        const reportYearCandidates: number[] = [];
        for (const sheetName of workbook.SheetNames.filter((name) => /^센터 자재 사용내역\(\d{2}월\)$/.test(name))) {
          const matrix = sheetMatrix(sheetName);
          matrix.slice(6).forEach((row, index) => {
            const date = importDate(row[2]);
            const categoryName = String(row[3] || "").trim();
            const modelName = String(row[4] || "").trim();
            const quantity = positiveNumber(row[6]);
            if (!date || !categoryName || !modelName || !quantity) return;
            reportYearCandidates.push(Number(date.slice(0, 4)));
            const workCategory = String(row[5] || "").trim();
            const transactionType = workCategory.includes("불량")
              ? "RECOVERED_BAD"
              : workCategory.includes("H&S")
                ? "HS_ISSUE"
                : workCategory.includes("분출")
                  ? "OTHER_COMPANY_ISSUE"
                  : "FIELD_USE";
            rows.push({
              sheetName,
              rowNumber: index + 7,
              transactionType,
              effectiveDate: date,
              categoryName,
              modelName,
              quantity,
              address: String(row[1] || "").trim(),
              workCategory,
              workDetails: String(row[7] || "").trim() || `${workCategory} 일괄등록`,
              workerName: String(row[8] || "").trim(),
              companyName: String(row[9] || "").trim(),
              unit: "EA",
            });
          });
        }
        const summarySheet = workbook.Sheets["사급자재 사용내역"];
        const summaryMatrix = summarySheet ? sheetMatrix("사급자재 사용내역") : undefined;
        if (summaryMatrix) {
          summaryMatrix.slice(0, 3).flat().forEach((value) => {
            for (const match of String(value || "").matchAll(/(?:^|\D)(20\d{2}|\d{2})년/g)) {
              reportYearCandidates.push(Number(match[1].length === 2 ? `20${match[1]}` : match[1]));
            }
          });
        }
        const reportYear = reportYearCandidates.length ? Math.max(...reportYearCandidates) : Number(today().slice(0, 4));
        if (summaryMatrix) {
          const matrix = summaryMatrix;
          let categoryName = "";
          matrix.slice(3).forEach((row, index) => {
            if (String(row[1] || "").trim()) categoryName = String(row[1]).trim();
            const modelName = String(row[2] || "").trim();
            if (!categoryName || !modelName) return;
            const unit = String(row[3] || "EA").trim() || "EA";
            const normal = positiveNumber(row[4]);
            const bad = positiveNumber(row[5]);
            const currentNormal = nonNegativeNumber(row[11]); // L열 현재고
            const currentBad = nonNegativeNumber(row[8]); // I열 불량재고
            rows.push({ sheetName: "사급자재 사용내역", rowNumber: index + 4, transactionType: "OPENING", effectiveDate: `${reportYear}-01-01`, categoryName, modelName, quantity: normal, stockState: "NORMAL", unit });
            rows.push({ sheetName: "사급자재 사용내역", rowNumber: index + 4, transactionType: "OPENING", effectiveDate: `${reportYear}-01-01`, categoryName, modelName, quantity: bad, stockState: "BAD", unit });
            for (let month = 0; month < 12; month += 1) {
              const receipt = positiveNumber(row[27 + month]);
              if (receipt) rows.push({ sheetName: "사급자재 사용내역", rowNumber: index + 4, transactionType: "RECEIPT", effectiveDate: `${reportYear}-${String(month + 1).padStart(2, "0")}-01`, categoryName, modelName, quantity: receipt, stockState: "NORMAL", unit });
            }
            rows.push({ sheetName: "사급자재 사용내역", rowNumber: index + 4, transactionType: "ADJUSTMENT", effectiveDate: today(), categoryName, modelName, quantity: currentNormal, stockState: "NORMAL", stocktakeTarget: true, stocktakeSourceColumn: "L", workCategory: "재고 일괄수정", workDetails: "사급자재 사용내역 L열 현재고 기준", unit });
            rows.push({ sheetName: "사급자재 사용내역", rowNumber: index + 4, transactionType: "ADJUSTMENT", effectiveDate: today(), categoryName, modelName, quantity: currentBad, stockState: "BAD", stocktakeTarget: true, stocktakeSourceColumn: "I", workCategory: "재고 일괄수정", workDetails: "사급자재 사용내역 I열 불량재고 기준", unit });
          });
        }
        if (!rows.length) throw new Error("공식 월간보고 형식의 등록 가능한 로우데이터가 없습니다.");
        const digest = await crypto.subtle.digest("SHA-256", fileBuffer);
        const sourceHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const bytes = new Uint8Array(fileBuffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        const sourceWorkbookBase64 = btoa(binary);
        const result = await inventoryApi.importOfficialField({ sourceFile: file.name, sourceHash, sourceWorkbookBase64, reportYear, rows });
        setNotice(`${result.inserted}건을 원장에 일괄등록했습니다.${result.skipped ? ` 중복 ${result.skipped}건은 제외했습니다.` : ""}`);
        await load();
        return;
      }
      const sheetName = "국사별 현재고";
      if (!workbook.Sheets[sheetName]) throw new Error("국사별 현재고 시트가 없습니다. 국사 예비품 현황 다운로드 파일을 사용해주세요.");
      const matrix = sheetMatrix(sheetName);
      const expectedHeaders = ["기준일", "권역", "국사", "제조사", "품목", "모델명", "신품", "양품", "불량", "수리중", "단위"];
      const headerIndex = matrix.findIndex((row) => expectedHeaders.every((header) => row.some((cell) => String(cell || "").trim() === header)));
      if (headerIndex < 0) throw new Error("국사별 현재고 시트의 헤더를 찾을 수 없습니다. 국사 예비품 현황 다운로드 파일을 사용해주세요.");
      const headerMap = new Map(matrix[headerIndex].map((value, index) => [String(value || "").trim(), index]));
      const valueAt = (row: unknown[], header: string) => row[headerMap.get(header) ?? -1];
      const rows: Array<Record<string, unknown>> = [];
      matrix.slice(headerIndex + 1).forEach((row, index) => {
        const rowNumber = headerIndex + index + 2;
        if (!row.some((value) => String(value ?? "").trim())) return;
        const effectiveDate = importDate(valueAt(row, "기준일"));
        const stationName = String(valueAt(row, "국사") || "").trim();
        const modelName = String(valueAt(row, "모델명") || "").trim();
        if (!effectiveDate || !stationName || !modelName) throw new Error(`${rowNumber}행의 기준일, 국사 또는 모델명이 비어 있습니다.`);
        const quantity = (header: string) => {
          const raw = String(valueAt(row, header) ?? "").replace(/,/g, "").trim();
          const parsed = raw === "" ? 0 : Number(raw);
          if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${rowNumber}행 ${header} 수량은 0 이상의 정수여야 합니다.`);
          return parsed;
        };
        rows.push({
          sheetName,
          rowNumber,
          effectiveDate,
          regionName: String(valueAt(row, "권역") || "").trim(),
          stationName,
          manufacturer: String(valueAt(row, "제조사") || "").trim(),
          itemType: String(valueAt(row, "품목") || "").trim(),
          modelName,
          newQuantity: quantity("신품"),
          serviceableQuantity: quantity("양품"),
          defectiveQuantity: quantity("불량"),
          inRepairQuantity: quantity("수리중"),
          unit: String(valueAt(row, "단위") || "EA").trim() || "EA",
        });
      });
      if (!rows.length) throw new Error("국사별 현재고 시트에 등록할 자료가 없습니다.");
      const digest = await crypto.subtle.digest("SHA-256", fileBuffer);
      const sourceHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const result = await inventoryApi.importStationInventory({ sourceFile: file.name, sourceHash, rows });
      setNotice(`예비품 재고 ${result.inserted}건을 일괄등록했습니다.${result.skipped ? ` 변경 없는 재고 ${result.skipped}건은 제외했습니다.` : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Excel을 읽지 못했습니다.");
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
      if (hsImportRef.current) hsImportRef.current.value = "";
    }
  };
  if (loading && !data)
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm font-bold text-[#173B57]">
        <Loader2 className="h-5 w-5 animate-spin" />
        자재관리 자료를 불러오는 중입니다.
      </div>
    );
  const canManage = Boolean(data?.permissions.canManage);
  const canOperate = Boolean(data?.permissions.canOperate);
  const canViewMaster = Boolean(data?.permissions.canViewMaster);
  const canImportExcel = Boolean(data?.permissions.canImportExcel);
  const canExportExcel = Boolean(data?.permissions.canExportExcel);
  const allTransactions =
    domain === "FIELD"
      ? data?.fieldTransactions || []
      : data?.stationTransactions || [];
  const ledgerQuery = ledgerQueryText.trim().toLowerCase();
  const transactions = allTransactions.filter((row) => {
    if (row.transactionType === "REVERSAL" || row.status !== "POSTED") return false;
    if (ledgerStartDate && row.effectiveDate < ledgerStartDate) return false;
    if (ledgerEndDate && row.effectiveDate > ledgerEndDate) return false;
    if (domain === "FIELD" && issueOnly && !["OTHER_COMPANY_ISSUE", "HS_ISSUE"].includes(row.transactionType)) return false;
    if (!ledgerQuery) return true;
    const values: Record<LedgerSearchField, string[]> = {
      ALL: [row.regionName || "", row.workerName || row.createdByName, row.categoryName || "", row.modelName, typeLabels[row.transactionType] || row.transactionType, row.transactionType],
      REGION: [row.regionName || ""],
      WORKER: [row.workerName || row.createdByName],
      CATEGORY: [row.categoryName || ""],
      MODEL: [row.modelName],
      TYPE: [typeLabels[row.transactionType] || row.transactionType, row.transactionType],
    };
    return values[ledgerSearchField].some((value) => value.toLowerCase().includes(ledgerQuery));
  });
  const fieldNormal = fieldRows.reduce(
      (s, r) => s + Number(r.normalQuantity),
      0,
    ),
    fieldBad = fieldRows.reduce((s, r) => s + Number(r.badQuantity), 0);
  const stationUsable = stationRows.reduce(
      (s, r) => s + Number(r.newQuantity) + Number(r.serviceableQuantity),
      0,
    ),
    stationBad = stationRows.reduce(
      (s, r) => s + Number(r.defectiveQuantity),
      0,
    ),
    stationRepair = stationRows.reduce(
      (s, r) => s + Number(r.inRepairQuantity),
      0,
    );
  return (
    <div id="material-view" className="space-y-4 pb-24 sm:pb-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#173B57] p-2.5 text-white">
              {domain === "FIELD" ? (
                <Boxes className="h-5 w-5" />
              ) : (
                <Warehouse className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-black text-[#173B57]">
                {domain === "FIELD" ? "유지보수 자재관리" : "국사 예비품"}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                원장 기준 현재고 · {domain === "FIELD" ? "사용 이력" : "관리 이력"} · Excel 보고
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              navigateTo(
                domain === "FIELD" ? "station_spares" : "material_list",
              )
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-extrabold text-[#1D6091] hover:bg-blue-100"
          >
            <ArrowLeftRight className="h-4 w-4" />
            {domain === "FIELD" ? "국사 예비품으로" : "유지보수 자재관리로"}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 sm:hidden">
          <button
            onClick={() => navigateTo("material_list")}
            className={`rounded-lg px-3 py-2 text-sm font-bold ${domain === "FIELD" ? "bg-white text-[#173B57] shadow-sm" : "text-slate-600"}`}
          >
            유지보수 자재관리
          </button>
          <button
            onClick={() => navigateTo("station_spares")}
            className={`rounded-lg px-3 py-2 text-sm font-bold ${domain === "STATION" ? "bg-white text-[#173B57] shadow-sm" : "text-slate-600"}`}
          >
            국사 예비품
          </button>
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"
        >
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {domain === "FIELD" ? (
          <>
            <MetricCard
              label="정상재고"
              value={fieldNormal.toLocaleString()}
              detail={`${fieldRows.length}개 모델 합계`}
            />
            <MetricCard
              label="불량재고"
              value={fieldBad.toLocaleString()}
              detail="회수 후 수리·폐기 대기"
              tone="red"
            />
            <MetricCard
              label="금월 사용량"
              value={String(
                (data?.fieldTransactions || []).filter((row) =>
                  row.effectiveDate.startsWith(today().slice(0, 7)) &&
                  ["FIELD_USE", "OTHER_COMPANY_ISSUE", "HS_ISSUE"].includes(row.transactionType) &&
                  row.status === "POSTED",
                ).reduce((sum, row) => sum + Number(row.quantity), 0),
              )}
              detail="현장사용·분출 수량"
              tone="orange"
            />
            <MetricCard
              label="최근 마감"
              value={data?.closures[0]?.periodKey || "-"}
              detail={data?.closures[0] ? "마감 완료" : "마감 내역 없음"}
              tone="slate"
            />
          </>
        ) : (
          <>
            <MetricCard
              label="사용 가능"
              value={stationUsable.toLocaleString()}
              detail="신품 + 양품"
            />
            <MetricCard
              label="불량"
              value={stationBad.toLocaleString()}
              detail="국사 보관 불량"
              tone="red"
            />
            <MetricCard
              label="수리 중"
              value={stationRepair.toLocaleString()}
              detail="업체 반출 수량"
              tone="orange"
            />
            <MetricCard
              label="조회 국사"
              value={String(filteredStationCount)}
              detail="국사 필터 적용 결과"
              tone="slate"
            />
          </>
        )}
      </div>
      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        {[
          ["STOCK", "현재고", PackageCheck],
          ["LEDGER", domain === "FIELD" ? "사용 이력" : "관리 이력", ClipboardList],
          ...(domain === "FIELD" ? [["ANALYTICS", "사용 통계", BarChart3]] : []),
          ...(canViewMaster ? [["MASTER", "기준정보", Settings2]] : []),
        ].map(([panel,label,Icon])=><button key={String(panel)} aria-pressed={activePanel===panel} onClick={()=>setActivePanel(panel as InventoryPanel)} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${activePanel===panel ? "bg-[#173B57] text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}><Icon className="h-4 w-4"/>{String(label)}</button>)}
        <button onClick={() => void load()} className="ml-auto rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="새로고침"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        {canOperate ? <button onClick={() => setShowTransaction(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 text-sm font-extrabold text-white shadow-sm hover:bg-[#9A3412]"><Plus className="h-4 w-4" />{domain === "FIELD" ? "자재사용 등록" : "예비품 관리 등록"}</button> : <div className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-500"><ShieldCheck className="h-4 w-4" />조회 전용</div>}
      </div>
      {activePanel === "STOCK" ? <section id="inventory-stock" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2"><PackageCheck className="h-5 w-5 text-[#2878B5]"/><h2 className="font-black text-[#173B57]">현재고</h2></div>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={stockQuery} onChange={(e)=>setStockQuery(e.target.value)} placeholder={domain === "FIELD" ? "품명, 세부모델 검색" : "품목, 모델, 제조사 검색"} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"/></div>
          {domain === "STATION" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Filter className="h-4 w-4 text-slate-400"/>
              <select
                aria-label="권역 필터"
                value={region}
                onChange={(e)=>{setRegion(e.target.value);setStationFilter("전체");}}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option>전체</option>
                {[...new Set((data?.stations||[]).map((item)=>item.regionName))].map((item)=><option key={item}>{item}</option>)}
              </select>
              <select
                aria-label="국사 필터"
                value={stationFilter}
                onChange={(e)=>setStationFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="전체">전체 국사</option>
                {stationOptions.map((item)=><option key={item.id} value={item.id}>{item.stationName}</option>)}
              </select>
              <select
                aria-label="제조사 필터"
                value={manufacturerFilter}
                onChange={(e)=>{setManufacturerFilter(e.target.value);setItemTypeFilter("전체");}}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="전체">전체 제조사</option>
                {[...new Set((data?.spareModels||[]).filter((item)=>item.active).map((item)=>item.manufacturer))].sort((a,b)=>String(a).localeCompare(String(b),"ko")).map((item)=><option key={item}>{item}</option>)}
              </select>
              <select
                aria-label="품목 필터"
                value={itemTypeFilter}
                onChange={(e)=>setItemTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="전체">전체 품목</option>
                {[...new Set((data?.spareModels||[]).filter((item)=>item.active&&(manufacturerFilter==="전체"||item.manufacturer===manufacturerFilter)).map((item)=>item.itemType))].sort((a,b)=>String(a).localeCompare(String(b),"ko")).map((item)=><option key={item}>{item}</option>)}
              </select>
              <label className="ml-auto flex items-center gap-2 font-semibold text-slate-600">
                <input type="checkbox" checked={inStockOnly} onChange={(e)=>setInStockOnly(e.target.checked)}/>
                재고 있는 모델만
              </label>
            </div>
          ):null}
        </div>
        {domain === "FIELD" ? <FieldStockTable rows={fieldRows}/> : <StationStockTable rows={stationRows}/>}
      </section> : null}
      {activePanel === "LEDGER" ? <section id="inventory-ledger" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-[#2878B5]"/><h2 className="font-black text-[#173B57]">{domain === "FIELD" ? "사용 이력" : "관리 이력"}</h2></div>
          <div className="flex flex-wrap gap-2"><select aria-label="사용 이력 검색 항목" value={ledgerSearchField} onChange={(e)=>setLedgerSearchField(e.target.value as LedgerSearchField)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400"><option value="ALL">전체</option><option value="REGION">지역</option><option value="WORKER">작업자</option><option value="CATEGORY">품명</option><option value="MODEL">세부모델</option><option value="TYPE">거래유형</option></select><div className="flex h-11 w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 sm:w-auto"><input type="date" aria-label="사용 이력 시작일" value={ledgerStartDate} max={ledgerEndDate||undefined} onChange={(e)=>setLedgerStartDate(e.target.value)} className="min-w-0 bg-transparent text-xs font-semibold text-slate-700 outline-none sm:text-sm"/><span className="text-xs text-slate-400">~</span><input type="date" aria-label="사용 이력 종료일" value={ledgerEndDate} min={ledgerStartDate||undefined} onChange={(e)=>setLedgerEndDate(e.target.value)} className="min-w-0 bg-transparent text-xs font-semibold text-slate-700 outline-none sm:text-sm"/></div><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={ledgerQueryText} onChange={(e)=>setLedgerQueryText(e.target.value)} placeholder="검색어를 입력하세요" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"/></div>{domain === "FIELD" ? <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600"><input type="checkbox" checked={issueOnly} onChange={(e)=>setIssueOnly(e.target.checked)} className="h-4 w-4 accent-[#2878B5]"/>분출내역만</label> : null}</div>
        </div>
        <LedgerTable
          domain={domain}
          rows={transactions}
          canEdit={(row) =>
            domain === "FIELD" &&
            Boolean(currentUser) &&
            (currentUser?.role === "admin" ||
              currentUser?.role === "public_official" ||
              (currentUser?.role === "team_leader" &&
                Boolean(currentUser.regionId) &&
                row.regionId === currentUser.regionId))
          }
          canDelete={(row) => domain === "STATION" ? canManage : (
            Boolean(currentUser) &&
            (currentUser?.role === "admin" || currentUser?.role === "public_official" ||
              (currentUser?.role === "team_leader" && Boolean(currentUser.regionId) && row.regionId === currentUser.regionId))
          )}
          onEdit={(row) => setEditingTransaction(row)}
          onDelete={(row) => {
            if (!window.confirm(`${row.effectiveDate} ${row.modelName} ${domain === "FIELD" ? "사용 이력" : "거래"}을 삭제하시겠습니까?`)) return;
            const reason = window.prompt(domain === "FIELD" ? "삭제사유를 입력하세요." : "거래취소 사유를 입력하세요.");
            if (reason) void runAction(
              () => domain === "FIELD" ? inventoryApi.deleteFieldTransaction(row.id, reason) : inventoryApi.reverse(row.id, reason),
              domain === "FIELD" ? "사용 이력을 삭제하고 현재고에 반영했습니다." : "국사 거래를 취소하고 재고에 반영했습니다.",
            );
          }}
        />
      </section> : null}
      {activePanel === "ANALYTICS" && domain === "FIELD" ? (
        <StatisticsPanel data={data}/>
      ) : null}
      {activePanel === "MASTER" && canViewMaster ? <section id="inventory-master">
        <MasterPanel
          domain={domain}
          data={data}
          canManage={canManage}
          onFieldModel={() => setShowFieldModel(true)}
          onSpareModel={() => setShowSpareModel(true)}
          onEditFieldModel={setEditingFieldModel}
          onEditSpareModel={setEditingSpareModel}
          onDeleteFieldModel={(model) => {
            if (!window.confirm(`${model.categoryName} · ${model.modelName} 기준정보를 삭제하시겠습니까?`)) return;
            void runAction(() => inventoryApi.deleteFieldModel(model.id), "현장 자재 기준정보를 삭제했습니다.");
          }}
          onDeleteSpareModel={(model) => {
            if (!window.confirm(`${model.itemType} · ${model.modelName} 기준정보를 삭제하시겠습니까?`)) return;
            void runAction(() => inventoryApi.deleteSpareModel(model.id), "국사 예비품 기준정보를 삭제했습니다.");
          }}
        />
      </section> : null}
      {canManage && (canImportExcel || canExportExcel) ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <h2 className="font-black text-[#173B57]">Excel 및 마감</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {domain === "FIELD" ? (
              <>
                {canExportExcel ? <><ExportButton
                  label="공식 월간 보고"
                  onClick={() => void handleExport("official")}
                />
                <ExportButton
                  label="능동자재 사진자료"
                  onClick={() => void handleExport("photos")}
                />
                <ExportButton
                  label="H&S 분출내역"
                  onClick={() => void handleExport("hs")}
                /></> : null}
              </>
            ) : (
              canExportExcel ? <ExportButton
                label="국사 예비품 현황"
                onClick={() => void handleExport("station")}
              /> : null
            )}
            {canImportExcel ? <button
              disabled={busy}
              onClick={() => importRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {domain === "FIELD" ? "자재 일괄등록" : "예비품 일괄등록"}
            </button> : null}
            {domain === "FIELD" && canImportExcel ? <button disabled={busy} onClick={()=>hsImportRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4"/>H&amp;S 분출 일괄등록</button> : null}
            {domain === "FIELD" ? (
              <button
                disabled={busy}
                onClick={() => {
                  const month = window.prompt(
                    "마감월을 YYYY-MM 형식으로 입력하세요.",
                    today().slice(0, 7),
                  );
                  if (month)
                    void runAction(
                      () => inventoryApi.closeMonth(month),
                      `${month} 자재 마감을 완료했습니다.`,
                    );
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-700 lg:ml-auto"
              >
                <ShieldCheck className="h-4 w-4" />월 마감
              </button>
            ) : null}
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file, domain === "FIELD" ? "official" : "station");
              }}
            />
            <input ref={hsImportRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e)=>{const file=e.target.files?.[0];if(file) void handleImport(file,"hs");}}/>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {domain === "FIELD"
              ? "공식 월간보고와 H&S 분출이력을 원장에 등록할 수 있습니다. 수정된 보고서를 다시 올리면 같은 보고 행은 새 수량으로 대체됩니다."
              : "국사 예비품 현황 다운로드 파일을 수정해 다시 올리면 신품·양품·불량·수리중 현재고를 일괄 반영합니다."}
          </p>
        </div>
      ) : null}
      {showTransaction && data ? (
        <TransactionModal
          domain={domain}
          data={data}
          busy={busy}
          onClose={() => setShowTransaction(false)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () =>
                domain === "FIELD"
                  ? inventoryApi.addFieldTransactions(input as FieldBatchTransactionInput)
                  : "items" in input
                    ? inventoryApi.addStationTransactions(input as SpareBatchTransactionInput)
                    : inventoryApi.addStationTransaction(input as InventoryTransactionInput),
              domain === "FIELD" ? "선택한 자재를 한 번에 원장에 등록했습니다." : "예비품 관리 내역을 원장에 등록했습니다.",
            );
            if (ok) setShowTransaction(false);
          }}
        />
      ) : null}
      {editingTransaction && data ? (
        <EditFieldTransactionModal
          row={editingTransaction}
          data={data}
          busy={busy}
          onClose={() => setEditingTransaction(null)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () => inventoryApi.updateFieldTransaction(editingTransaction.id, input),
              "사용 이력을 수정하고 현재고에 반영했습니다.",
            );
            if (ok) setEditingTransaction(null);
          }}
        />
      ) : null}
      {showFieldModel && data ? (
        <FieldModelModal
          data={data}
          busy={busy}
          onClose={() => setShowFieldModel(false)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () => inventoryApi.addFieldModel(input),
              "현장 자재 모델을 등록했습니다.",
            );
            if (ok) setShowFieldModel(false);
          }}
        />
      ) : null}
      {editingFieldModel && data ? (
        <FieldModelModal
          data={data}
          model={editingFieldModel}
          busy={busy}
          onClose={() => setEditingFieldModel(null)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () => inventoryApi.updateFieldModel(editingFieldModel.id, input),
              "현장 자재 기준정보를 수정했습니다.",
            );
            if (ok) setEditingFieldModel(null);
          }}
        />
      ) : null}
      {showSpareModel ? (
        <SpareModelModal
          busy={busy}
          onClose={() => setShowSpareModel(false)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () => inventoryApi.addSpareModel(input),
              "국사 예비품 모델을 등록했습니다.",
            );
            if (ok) setShowSpareModel(false);
          }}
        />
      ) : null}
      {editingSpareModel ? (
        <SpareModelModal
          model={editingSpareModel}
          busy={busy}
          onClose={() => setEditingSpareModel(null)}
          onSubmit={async (input) => {
            const ok = await runAction(
              () => inventoryApi.updateSpareModel(editingSpareModel.id, input),
              "국사 예비품 기준정보를 수정했습니다.",
            );
            if (ok) setEditingSpareModel(null);
          }}
        />
      ) : null}
      {busy ? (
        <div className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit items-center gap-2 rounded-full bg-[#173B57] px-4 py-2 text-sm font-bold text-white shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          처리 중
        </div>
      ) : null}
      <span className="sr-only">접속 사용자 {currentUser?.name}</span>
    </div>
  );
};

type MaterialStatisticDraft = {
  periodType: "month" | "range" | "year";
  month: string;
  year: string;
  from: string;
  to: string;
  regionName: string;
  categoryName: string;
  modelName: string;
  workerName: string;
  issueOnly: boolean;
};
const initialMaterialStatisticDraft = (): MaterialStatisticDraft => ({
  periodType: "month",
  month: today().slice(0, 7),
  year: today().slice(0, 4),
  from: currentMonthRange().start,
  to: today(),
  regionName: "",
  categoryName: "",
  modelName: "",
  workerName: "",
  issueOnly: false,
});
const materialStatisticPeriod = (filters: MaterialStatisticDraft) => {
  if (filters.periodType === "year") return { start: `${filters.year}-01-01`, end: `${filters.year}-12-31` };
  if (filters.periodType === "range") return { start: filters.from, end: filters.to };
  const [year, month] = filters.month.split("-").map(Number);
  return { start: `${filters.month}-01`, end: `${filters.month}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}` };
};
const materialStatisticApiFilters = (filters: MaterialStatisticDraft): FieldStatisticFilters => ({
  regionName: filters.regionName || undefined,
  categoryName: filters.categoryName || undefined,
  modelName: filters.modelName || undefined,
  workerName: filters.workerName || undefined,
  issueOnly: filters.issueOnly || undefined,
});

const StatisticsPanel = ({ data }: { data: InventoryBootstrap | null }) => {
  const [draft, setDraft] = useState<MaterialStatisticDraft>(initialMaterialStatisticDraft);
  const [applied, setApplied] = useState<MaterialStatisticDraft>(initialMaterialStatisticDraft);
  const [statistics, setStatistics] = useState<FieldUsageStatistics | null>(null);
  const [meta, setMeta] = useState<FieldStatisticMeta | null>(null);
  const [itemRows, setItemRows] = useState<FieldUsageItemStatistic[]>([]);
  const [issueRows, setIssueRows] = useState<FieldIssueDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void inventoryApi.fieldStatisticsMeta().then(setMeta).catch((reason:unknown)=>setError(reason instanceof Error ? reason.message : "통계 조회조건을 불러오지 못했습니다."));
  }, []);
  useEffect(() => {
    let cancelled = false;
    const period = materialStatisticPeriod(applied);
    const filters = materialStatisticApiFilters(applied);
    setLoading(true);
    setError("");
    void Promise.all([
      inventoryApi.fieldStatistics(period.start, period.end, filters),
      inventoryApi.fieldItemStatistics(period.start, period.end, "ALL", "", filters),
      inventoryApi.fieldIssueDetails(period.start, period.end, "ALL", "", filters),
    ]).then(([summary, items, issues]) => {
      if (!cancelled) { setStatistics(summary); setItemRows(items); setIssueRows(issues); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "통계를 불러오지 못했습니다.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applied]);
  const regionOptions = useMemo(() => (meta?.regions || []).map((region)=>region.name), [meta]);
  const categoryOptions = useMemo(() => (data?.categories || []).filter((category)=>category.active).map((category)=>category.categoryName), [data]);
  const modelOptions = useMemo(() => [...new Set((data?.fieldModels || []).filter((model)=>model.active && (!draft.categoryName || model.categoryName===draft.categoryName)).map((model)=>model.modelName))].sort((a,b)=>a.localeCompare(b,"ko")), [data, draft.categoryName]);
  const workerOptions = useMemo(() => (meta?.workers || []).filter((worker)=>!draft.regionName || worker.regionName===draft.regionName || !worker.regionName).map((worker)=>worker.name), [draft.regionName, meta]);
  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    const period = materialStatisticPeriod(draft);
    if (!period.start || !period.end || period.start > period.end) { setError("조회 시작일은 종료일보다 늦을 수 없습니다."); return; }
    setApplied({...draft});
  };
  const resetFilters = () => {
    const reset = initialMaterialStatisticDraft();
    setDraft(reset);
    setApplied(reset);
  };
  const period = materialStatisticPeriod(applied);
  return (
    <section id="inventory-analytics" className="space-y-4" aria-label="자재 사용 통계">
      <div className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-[#F28C28]"/><div><h2 className="text-xl font-black text-[#173B57]">자재사용 통계</h2><p className="text-xs text-slate-500">기간·지역·항목·세부모델·담당자를 기준으로 사용량을 조회합니다.</p></div></div>
      <form onSubmit={applyFilters} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="자재사용 통계 조회 조건">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] font-bold text-slate-600">기간 구분<select aria-label="자재통계 기간 구분" value={draft.periodType} onChange={(e)=>setDraft((current)=>({...current,periodType:e.target.value as MaterialStatisticDraft["periodType"]}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="month">월별</option><option value="range">기간별</option><option value="year">연도별</option></select></label>
          {draft.periodType === "month" ? <label className="text-[11px] font-bold text-slate-600">조회 월<input required aria-label="자재통계 조회 월" type="month" value={draft.month} onChange={(e)=>setDraft((current)=>({...current,month:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"/></label> : null}
          {draft.periodType === "year" ? <label className="text-[11px] font-bold text-slate-600">조회 연도<input required aria-label="자재통계 조회 연도" type="number" min="2000" max="2100" value={draft.year} onChange={(e)=>setDraft((current)=>({...current,year:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"/></label> : null}
          {draft.periodType === "range" ? <><label className="text-[11px] font-bold text-slate-600">시작일<input required aria-label="자재통계 시작일" type="date" value={draft.from} onChange={(e)=>setDraft((current)=>({...current,from:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"/></label><label className="text-[11px] font-bold text-slate-600">종료일<input required aria-label="자재통계 종료일" type="date" value={draft.to} onChange={(e)=>setDraft((current)=>({...current,to:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"/></label></> : null}
          <label className="text-[11px] font-bold text-slate-600">지역<select aria-label="자재통계 지역" value={draft.regionName} onChange={(e)=>setDraft((current)=>({...current,regionName:e.target.value,workerName:""}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="">전체 지역</option>{regionOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select></label>
          <label className="text-[11px] font-bold text-slate-600">항목<select aria-label="자재통계 항목" value={draft.categoryName} onChange={(e)=>setDraft((current)=>({...current,categoryName:e.target.value,modelName:""}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="">전체 항목</option>{categoryOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select></label>
          <label className="text-[11px] font-bold text-slate-600">세부모델<select aria-label="자재통계 세부모델" value={draft.modelName} onChange={(e)=>setDraft((current)=>({...current,modelName:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="">전체 세부모델</option>{modelOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select></label>
          <label className="text-[11px] font-bold text-slate-600">담당자<select aria-label="자재통계 담당자" value={draft.workerName} onChange={(e)=>setDraft((current)=>({...current,workerName:e.target.value}))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="">전체 담당자</option>{workerOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2"><label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600"><input type="checkbox" checked={draft.issueOnly} onChange={(e)=>setDraft((current)=>({...current,issueOnly:e.target.checked}))} className="h-4 w-4 accent-[#2878B5]"/>분출내역만</label><div className="ml-auto flex gap-2"><button type="button" onClick={resetFilters} className="inline-flex h-10 items-center gap-1 rounded-xl bg-slate-100 px-4 text-xs font-bold text-slate-700"><FilterX className="h-4 w-4"/>초기화</button><button type="submit" className="inline-flex h-10 items-center gap-1 rounded-xl bg-[#2878B5] px-5 text-xs font-bold text-white"><Search className="h-4 w-4"/>조회</button></div></div>
      </form>
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {loading && !statistics ? <div className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-600"><Loader2 className="h-5 w-5 animate-spin"/>통계를 집계하는 중입니다.</div> : null}
      {statistics ? <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="총 사용·분출량" value={Number(statistics.totals.totalQuantity).toLocaleString()} detail={`${Number(statistics.totals.transactionCount).toLocaleString()}건 합계`}/>
          <MetricCard label="현장 사용량" value={Number(statistics.totals.fieldUseQuantity).toLocaleString()} detail="현장사용 합계" tone="orange"/>
          <MetricCard label="분출량" value={Number(statistics.totals.issueQuantity).toLocaleString()} detail="타사 + H&S 분출" tone="red"/>
          <MetricCard label="담당자" value={Number(statistics.totals.workerCount).toLocaleString()} detail={`${period.start} ~ ${period.end}`} tone="slate"/>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <StatisticsTable title="지역/팀별" rows={statistics.byRegion}/>
          <StatisticsTable title="개인별" rows={statistics.byWorker}/>
        </div>
        {loading ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500"><Loader2 className="h-5 w-5 animate-spin"/>조회 조건을 적용하는 중입니다.</div> : <ItemUsageTable rows={itemRows}/>}
        <IssueDetailTable rows={issueRows}/>
      </> : null}
    </section>
  );
};

const ItemUsageTable = ({ rows }: { rows: FieldUsageItemStatistic[] }) => (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-[#173B57]">세부모델 사용 통계</h3></div>
      <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[560px] text-sm"><thead className="sticky top-0 bg-[#173B57] text-white"><tr>{["순위","항목","세부모델","사용량","건수"].map((label)=><th key={label} className="px-3 py-3 text-left text-xs font-extrabold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index)=><tr key={`table-${row.categoryName}-${row.modelName}`}><td className="px-3 py-3 text-slate-400">{index+1}</td><td className="px-3 py-3 font-bold text-slate-700">{row.categoryName}</td><td className="px-3 py-3 font-extrabold text-[#173B57]">{row.modelName}</td><td className="px-3 py-3 text-right font-black tabular-nums">{Number(row.quantity).toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums text-slate-500">{Number(row.count).toLocaleString()}</td></tr>)}</tbody></table>{!rows.length ? <div className="p-8 text-center text-sm text-slate-400">선택한 조건의 사용 내역이 없습니다.</div> : null}</div>
    </div>
);

const IssueDetailTable = ({ rows }: { rows: FieldIssueDetail[] }) => <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><h3 className="font-black text-[#173B57]">분출 상세내역</h3><p className="text-xs text-slate-500">타사 분출 및 H&S 분출 원장</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#2878B5]">{rows.length.toLocaleString()}건</span></div>
  <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[860px] text-sm"><thead className="sticky top-0 bg-[#173B57] text-white"><tr>{["분출일","분출개소","분출구분","항목","세부모델","수량"].map((label)=><th key={label} className="px-4 py-3 text-left text-xs font-extrabold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row)=><tr key={row.id} className="hover:bg-blue-50/40"><td className="whitespace-nowrap px-4 py-3">{row.effectiveDate}</td><td className="px-4 py-3 font-semibold text-slate-700">{row.releasePlace}</td><td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${row.issueType === "H&S 분출" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>{row.issueType}</span></td><td className="px-4 py-3 font-bold text-slate-700">{row.categoryName}</td><td className="px-4 py-3 font-extrabold text-[#173B57]">{row.modelName}</td><td className="px-4 py-3 text-right font-black tabular-nums">{Number(row.quantity).toLocaleString()}</td></tr>)}</tbody></table>{!rows.length ? <div className="p-8 text-center text-sm text-slate-400">선택한 조건의 분출내역이 없습니다.</div> : null}</div>
</div>;

const StatisticsTable = ({ title, rows }: { title: string; rows: Array<{ label: string; quantity: number; count: number }> }) => {
  const maximum = Math.max(1, ...rows.map((row) => Number(row.quantity)));
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 px-4 py-3"><h3 className="font-black text-[#173B57]">{title} 통계</h3></div>
    <div className="max-h-[360px] overflow-auto">
      {rows.length ? rows.map((row)=><div key={`${title}-${row.label}`} className="border-b border-slate-100 px-4 py-3 last:border-0">
        <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-bold text-slate-700" title={row.label}>{row.label}</span><span className="shrink-0 font-black tabular-nums text-[#173B57]">{Number(row.quantity).toLocaleString()} <span className="text-xs font-semibold text-slate-400">/ {Number(row.count).toLocaleString()}건</span></span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#2878B5]" style={{width:`${Math.max(2, Number(row.quantity) / maximum * 100)}%`}}/></div>
      </div>) : <div className="p-8 text-center text-sm text-slate-400">선택한 기간의 사용 내역이 없습니다.</div>}
    </div>
  </div>;
};

const FieldStockTable = ({ rows }: { rows: FieldBalance[] }) => (
    <div className="max-h-[520px] overflow-auto" tabIndex={0} role="region" aria-label="현장 자재 현재고 표">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 z-10 bg-[#173B57] text-white">
          <tr>
            {[
              "품명",
              "세부모델",
              "구분",
              "정상재고",
              "불량재고",
              "단위",
            ].map((item) => (
              <th
                key={item}
                className="px-4 py-3 text-left text-xs font-extrabold"
              >
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.modelId} className="hover:bg-blue-50/40">
              <td className="px-4 py-3 font-bold text-slate-700">
                {row.categoryName}
              </td>
              <td className="px-4 py-3 font-extrabold text-[#173B57]">
                {row.modelName}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${row.materialKind === "ACTIVE" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}
                >
                  {row.materialKind === "ACTIVE" ? "능동" : "수동"}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-base font-black text-[#2878B5]">
                {formatStockQuantity(row.normalQuantity)}
              </td>
              <td className="px-4 py-3 text-right text-base font-black text-red-600">
                {formatStockQuantity(row.badQuantity)}
              </td>
              <td className="px-4 py-3 text-slate-500">{row.unit}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={6} className="px-4 py-14 text-center text-slate-600">
                등록된 현장 자재 모델이 없습니다.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
);
const StationStockTable = ({ rows }: { rows: SpareBalance[] }) => {
  const totals = rows.reduce(
    (sum, row) => {
      const newQuantity = Number(row.newQuantity);
      const serviceableQuantity = Number(row.serviceableQuantity);
      const defectiveQuantity = Number(row.defectiveQuantity);
      const inRepairQuantity = Number(row.inRepairQuantity);
      sum.newQuantity += newQuantity;
      sum.serviceableQuantity += serviceableQuantity;
      sum.defectiveQuantity += defectiveQuantity;
      sum.inRepairQuantity += inRepairQuantity;
      sum.usableQuantity += newQuantity + serviceableQuantity;
      sum.totalQuantity += newQuantity + serviceableQuantity + defectiveQuantity + inRepairQuantity;
      return sum;
    },
    { newQuantity: 0, serviceableQuantity: 0, defectiveQuantity: 0, inRepairQuantity: 0, usableQuantity: 0, totalQuantity: 0 },
  );
  return (
    <div className="max-h-[520px] overflow-auto" tabIndex={0} role="region" aria-label="국사 예비품 현재고 표">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 z-10 bg-[#173B57] text-white">
          <tr>
            {[
              "권역",
              "국사",
              "제조사",
              "품목",
              "모델명",
              "신품",
              "양품",
              "불량",
              "수리중",
              "사용가능",
              "전체보유",
            ].map((item) => (
              <th
                key={item}
                className="px-3 py-3 text-left text-xs font-extrabold"
              >
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const usable =
                Number(row.newQuantity) + Number(row.serviceableQuantity),
              total =
                usable +
                Number(row.defectiveQuantity) +
                Number(row.inRepairQuantity);
            return (
              <tr key={`${row.stationId}-${row.modelId}`}>
                <td className="px-3 py-3 text-slate-500">{row.regionName}</td>
                <td className="px-3 py-3 font-extrabold text-[#173B57]">
                  {row.stationName}
                </td>
                <td className="px-3 py-3">{row.manufacturer}</td>
                <td className="px-3 py-3">{row.itemType}</td>
                <td className="px-3 py-3 font-bold">{row.modelName}</td>
                {[
                  row.newQuantity,
                  row.serviceableQuantity,
                  row.defectiveQuantity,
                  row.inRepairQuantity,
                  usable,
                  total,
                ].map((value, index) => (
                  <td
                    key={index}
                    className={`px-3 py-3 text-right font-black ${index === 2 ? "text-red-600" : index === 3 ? "text-orange-600" : "text-[#2878B5]"}`}
                  >
                    {formatStockQuantity(value)}
                  </td>
                ))}
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td
                colSpan={12}
                className="px-4 py-14 text-center text-slate-600"
              >
                조건에 맞는 예비품 재고가 없습니다.
              </td>
            </tr>
          ) : null}
        </tbody>
        {rows.length ? (
          <tfoot className="sticky bottom-0 z-10 border-t-2 border-[#173B57] bg-blue-50 shadow-[0_-2px_8px_rgba(15,23,42,0.08)]">
            <tr>
              <td colSpan={5} className="px-3 py-3 text-center font-black text-[#173B57]">합계</td>
              {[
                totals.newQuantity,
                totals.serviceableQuantity,
                totals.defectiveQuantity,
                totals.inRepairQuantity,
                totals.usableQuantity,
                totals.totalQuantity,
              ].map((value, index) => (
                <td
                  key={index}
                  className={`px-3 py-3 text-right text-base font-black ${index === 2 ? "text-red-600" : index === 3 ? "text-orange-600" : "text-[#173B57]"}`}
                >
                  {formatStockQuantity(value)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
};
const LedgerTable = ({
  domain,
  rows,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  domain: Domain;
  rows: InventoryTransaction[];
  canEdit: (row: InventoryTransaction) => boolean;
  canDelete: (row: InventoryTransaction) => boolean;
  onEdit: (row: InventoryTransaction) => void;
  onDelete: (row: InventoryTransaction) => void;
}) => (
    <div className="max-h-[520px] overflow-auto" tabIndex={0} role="region" aria-label={domain === "FIELD" ? "자재 사용 이력 표" : "예비품 관리 이력 표"}>
      <table className={`w-full text-sm ${domain === "FIELD" ? "min-w-[1080px]" : "min-w-[940px]"}`}>
        <thead className="sticky top-0 z-10 bg-[#173B57] text-white">
          <tr>
            {(domain === "FIELD" ? ["일자", "지역", "거래유형", "품명", "세부모델", "수량", "분출", "작업자", "관리"] : ["일자", "거래유형", "모델", "수량", "국사/이동", "처리자", "상태", ""]).map((item) => (
              <th
                key={item}
                className="px-3 py-3 text-left text-xs font-extrabold"
              >
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => domain === "FIELD" ? (() => {
            const distribution = ["OTHER_COMPANY_ISSUE", "HS_ISSUE"].includes(row.transactionType);
            const controls = canEdit(row);
            return <tr key={row.id}>
              <td className="px-3 py-3">{row.effectiveDate}</td>
              <td className="px-3 py-3"><div className="font-bold text-slate-700">{row.regionName || "미지정"}</div>{row.location ? <div className="mt-0.5 max-w-48 truncate text-[11px] text-slate-500" title={row.location}>{row.location}</div> : null}</td>
              <td className="px-3 py-3 font-bold">{typeLabels[row.transactionType] || row.transactionType}</td>
              <td className="px-3 py-3 font-bold text-[#173B57]">{row.categoryName || "-"}</td>
              <td className="px-3 py-3 font-bold text-[#173B57]">{row.modelName}</td>
              <td className="px-3 py-3 text-right font-black">{distribution ? "-" : Number(row.quantity).toLocaleString()}</td>
              <td className="px-3 py-3 text-right font-black text-orange-600">{distribution ? Number(row.quantity).toLocaleString() : "-"}</td>
              <td className="px-3 py-3">{row.workerName || row.createdByName}</td>
              <td className="px-3 py-3"><div className="flex gap-1">{controls ? <><button onClick={()=>onEdit(row)} className="rounded border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700">수정</button><button onClick={()=>onDelete(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">삭제</button></> : <span className="text-xs text-slate-400">-</span>}</div></td>
            </tr>;
          })() : (
            <tr key={row.id}>
              <td className="px-3 py-3">{row.effectiveDate}</td>
              <td className="px-3 py-3 font-bold">
                {typeLabels[row.transactionType] || row.transactionType}
              </td>
              <td className="px-3 py-3 font-bold text-[#173B57]">
                {row.modelName}
              </td>
              <td className="px-3 py-3 text-right font-black">
                {Number(row.quantity).toLocaleString()}
              </td>
              <td className="px-3 py-3 text-slate-500">
                {row.destinationStationName
                  ? `${row.sourceStationName} → ${row.destinationStationName}`
                  : row.sourceStationName || "-"}
              </td>
              <td className="px-3 py-3">{row.createdByName}</td>
              <td className="px-3 py-3">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${row.status === "POSTED" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {row.status === "POSTED" ? "정상" : "역분개됨"}
                </span>
              </td>
              <td className="px-3 py-3 text-right">
                {row.status === "POSTED" &&
                row.transactionType !== "REVERSAL" &&
                canEdit(row) ? (
                  <button
                    onClick={() => onEdit(row)}
                    className="mr-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700"
                  >
                    수량 수정
                  </button>
                ) : null}
                {canDelete(row) &&
                row.status === "POSTED" &&
                row.transactionType !== "REVERSAL" ? (
                  <button
                    onClick={() => onDelete(row)}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-600"
                  >
                    거래삭제
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={domain === "FIELD" ? 9 : 8} className="px-4 py-14 text-center text-slate-600">
                {domain === "FIELD" ? "사용 이력이 없습니다." : "관리 이력이 없습니다."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
);
const MasterPanel = ({
  domain,
  data,
  canManage,
  onFieldModel,
  onSpareModel,
  onEditFieldModel,
  onEditSpareModel,
  onDeleteFieldModel,
  onDeleteSpareModel,
}: {
  domain: Domain;
  data: InventoryBootstrap | null;
  canManage: boolean;
  onFieldModel: () => void;
  onSpareModel: () => void;
  onEditFieldModel: (model: FieldMaterialModel) => void;
  onEditSpareModel: (model: SpareModel) => void;
  onDeleteFieldModel: (model: FieldMaterialModel) => void;
  onDeleteSpareModel: (model: SpareModel) => void;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="font-black text-[#173B57]">
          {domain === "FIELD" ? "현장 자재 기준정보" : "국사 예비품 기준정보"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          과거 원장을 보호하기 위해 삭제 대신 사용중지로 관리합니다.
        </p>
      </div>
      {canManage ? (
        <button
          onClick={domain === "FIELD" ? onFieldModel : onSpareModel}
          className="inline-flex items-center gap-2 rounded-xl bg-[#173B57] px-3 py-2 text-sm font-bold text-white"
        >
          <Plus className="h-4 w-4" />
          모델 등록
        </button>
      ) : null}
    </div>
    {domain === "STATION" ? <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">등록 국사 {data?.stations.length || 0}개 · 기남·수원 권역</div> : null}
    <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-slate-200" tabIndex={0} role="region" aria-label={domain === "FIELD" ? "현장 자재 기준정보 표" : "국사 예비품 기준정보 표"}>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 z-10 bg-[#173B57] text-white"><tr>{(domain === "FIELD" ? ["품명","세부모델","능동/수동","단위","관리"] : ["제조사","품목","모델","단위","관리"]).map((label)=><th key={label} className="px-4 py-3 text-left text-xs font-extrabold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {domain === "FIELD" ? (data?.fieldModels || []).filter((item)=>item.active).map((item)=><tr key={item.id}><td className="px-4 py-3 font-bold text-blue-700">{item.categoryName}</td><td className="px-4 py-3 font-extrabold text-[#173B57]">{item.modelName}</td><td className="px-4 py-3">{item.materialKind === "ACTIVE" ? "능동" : "수동"}</td><td className="px-4 py-3">{item.unit}</td><td className="px-4 py-3">{canManage?<div className="flex gap-1"><button onClick={()=>onEditFieldModel(item)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700"><Pencil className="h-3 w-3"/>수정</button><button onClick={()=>onDeleteFieldModel(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-600"><Trash2 className="h-3 w-3"/>삭제</button></div>:"-"}</td></tr>) : (data?.spareModels || []).filter((item)=>item.active).map((item)=><tr key={item.id}><td className="px-4 py-3 font-bold text-blue-700">{item.manufacturer}</td><td className="px-4 py-3">{item.itemType}</td><td className="px-4 py-3 font-extrabold text-[#173B57]">{item.modelName}</td><td className="px-4 py-3">{item.unit}</td><td className="px-4 py-3">{canManage?<div className="flex gap-1"><button onClick={()=>onEditSpareModel(item)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700"><Pencil className="h-3 w-3"/>수정</button><button onClick={()=>onDeleteSpareModel(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-600"><Trash2 className="h-3 w-3"/>삭제</button></div>:"-"}</td></tr>)}
        </tbody>
      </table>
    </div>
  </div>
);

const ModalShell = ({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) => (
  <div
    className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
        <h2 className="text-lg font-black text-[#173B57]">{title}</h2>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);
const Field = ({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) => (
  <label className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
    <span className="text-sm font-bold text-slate-700">{label}</span>
    {children}
  </label>
);
const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:bg-white";
const EditFieldTransactionModal = ({
  row,
  data,
  busy,
  onClose,
  onSubmit,
}: {
  row: InventoryTransaction;
  data: InventoryBootstrap;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: FieldTransactionUpdateInput) => Promise<void>;
}) => {
  const initialModel = data.fieldModels.find((model) => model.id === row.modelId)
    || data.fieldModels.find((model) => model.modelName === row.modelName && model.categoryName === row.categoryName)
    || data.fieldModels.find((model) => model.active);
  const [transactionType, setTransactionType] = useState(row.transactionType);
  const [date, setDate] = useState(row.effectiveDate);
  const [categoryId, setCategoryId] = useState(initialModel?.categoryId || "");
  const [modelId, setModelId] = useState(initialModel?.id || "");
  const [quantity, setQuantity] = useState(Number(row.quantity));
  const [address, setAddress] = useState(row.location || "");
  const [purpose, setPurpose] = useState(row.workDetails || row.purpose || "");
  const [stockState, setStockState] = useState(row.stockState || "NORMAL");
  const [direction, setDirection] = useState(1);
  const [reason, setReason] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      transactionType,
      effectiveDate: date,
      modelId,
      quantity,
      stockState,
      direction,
      location: address,
      purpose,
      workDetails: purpose,
      companyName: transactionType === "HS_ISSUE" ? "H&S" : transactionType === "OTHER_COMPANY_ISSUE" ? "타사" : undefined,
      reason,
    });
  };
  return (
    <ModalShell title="자재 사용이력 수정" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="거래유형"><select className={inputClass} value={transactionType} onChange={(event) => { const next=event.target.value;setTransactionType(next);if(next==="HS_ISSUE"&&!hsIssueLocations.includes(address as typeof hsIssueLocations[number]))setAddress(hsIssueLocations[0]); }}>{fieldEditTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="거래일자"><input className={inputClass} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="품명"><select className={inputClass} value={categoryId} onChange={(event) => { const next = event.target.value; setCategoryId(next); setModelId(data.fieldModels.find((model) => model.active && model.categoryId === next)?.id || ""); }}>{data.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.categoryName}</option>)}</select></Field>
        <Field label="세부모델"><select className={inputClass} required value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">선택</option>{data.fieldModels.filter((model) => model.active && model.categoryId === categoryId).map((model) => <option key={model.id} value={model.id}>{model.modelName}</option>)}</select></Field>
        <Field label="수량"><input className={inputClass} type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></Field>
        {["OPENING", "ADJUSTMENT"].includes(transactionType) ? <Field label="재고상태"><select className={inputClass} value={stockState} onChange={(event) => setStockState(event.target.value)}><option value="NORMAL">정상</option><option value="BAD">불량</option></select></Field> : null}
        {transactionType === "ADJUSTMENT" ? <Field label="조정방향"><select className={inputClass} value={direction} onChange={(event) => setDirection(Number(event.target.value))}><option value={1}>재고 증가</option><option value={-1}>재고 감소</option></select></Field> : null}
        <Field label="사용 주소" wide>{transactionType === "HS_ISSUE" ? <select aria-label="H&S 분출 지점" className={inputClass} required value={address} onChange={(event)=>setAddress(event.target.value)}><option value="">선택</option>{hsIssueLocations.map((location)=><option key={location} value={location}>{location}</option>)}</select> : <input className={inputClass} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="설치장소 또는 작업주소" />}</Field>
        <Field label="작업내용 / 사유" wide><textarea className="min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-blue-400" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
        <Field label="수정사유" wide><input className={inputClass} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="수정한 이유를 입력하세요" /></Field>
        <div className="flex justify-end gap-2 border-t pt-4 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 font-bold">취소</button><button disabled={busy || !modelId || !Number.isInteger(quantity) || quantity < 1 || !reason.trim()} className="rounded-xl bg-[#173B57] px-5 py-2.5 font-extrabold text-white disabled:opacity-50">수정 저장</button></div>
      </form>
    </ModalShell>
  );
};
const TransactionModal = ({
  domain,
  data,
  busy,
  onClose,
  onSubmit,
}: {
  domain: Domain;
  data: InventoryBootstrap;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: InventoryTransactionInput | FieldBatchTransactionInput | SpareBatchTransactionInput) => Promise<void>;
}) => {
  const allowed =
    domain === "FIELD"
      ? fieldTypes.filter(
          ([t]) => data.permissions.canManage || managerFieldTypes.has(t),
        )
      : stationTypes.filter(
          ([t]) => data.permissions.canManage || managerStationTypes.has(t),
        );
  const [type, setType] = useState<string>(allowed[0]?.[0] || "FIELD_USE");
  const [date, setDate] = useState(today());
  const [workerId, setWorkerId] = useState(data.workers[0]?.id || "");
  const activeFieldModels = data.fieldModels.filter((item) => item.active);
  const fieldNormalStock = new Map(data.fieldBalances.map((balance) => [balance.modelId, Number(balance.normalQuantity)]));
  const fieldBadStock = new Map(data.fieldBalances.map((balance) => [balance.modelId, Number(balance.badQuantity)]));
  const eligibleFieldModels = (transactionType: string, categoryId: string) =>
    activeFieldModels.filter((model) =>
      model.categoryId === categoryId
      && (transactionType !== "FIELD_USE" || (fieldNormalStock.get(model.id) || 0) > 0)
      && (!badFieldStockTypes.has(transactionType) || (fieldBadStock.get(model.id) || 0) > 0)
    );
  const eligibleFieldCategories = (transactionType: string) =>
    data.categories.filter((category) => category.active && eligibleFieldModels(transactionType, category.id).length > 0);
  const firstFieldType = allowed[0]?.[0] || "FIELD_USE";
  const firstCategoryId = eligibleFieldCategories(firstFieldType)[0]?.id || "";
  const firstFieldModelId = eligibleFieldModels(firstFieldType, firstCategoryId)[0]?.id || "";
  type FieldLine = { key: string; transactionType: string; categoryId: string; modelId: string; quantity: number };
  const makeFieldLine = (): FieldLine => ({ key: requestKey(), transactionType: firstFieldType, categoryId: firstCategoryId, modelId: firstFieldModelId, quantity: 1 });
  const [fieldItems, setFieldItems] = useState<FieldLine[]>([makeFieldLine()]);
  const [includeFieldDefective, setIncludeFieldDefective] = useState(false);
  const [fieldDefectiveCategoryId, setFieldDefectiveCategoryId] = useState("");
  const [fieldDefectiveModelId, setFieldDefectiveModelId] = useState("");
  const [fieldDefectiveQuantity, setFieldDefectiveQuantity] = useState(1);
  const activeSpareModels = data.spareModels.filter((item) => item.active);
  const initialStationId = data.stations.find((item) => item.active)?.id || "";
  const initialState = domain === "FIELD" ? "NORMAL" : "SERVICEABLE";
  const initialSpareModel = activeSpareModels.find((model) =>
    domain !== "STATION"
    || type !== "USE"
    || data.stationBalances.some((balance) => balance.stationId === initialStationId && balance.modelId === model.id && Number(balance.serviceableQuantity) > 0),
  );
  const [manufacturer, setManufacturer] = useState(initialSpareModel?.manufacturer || "");
  const [itemType, setItemType] = useState(initialSpareModel?.itemType || "");
  const [modelId, setModelId] = useState(initialSpareModel?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [includeDefective, setIncludeDefective] = useState(false);
  const [defectiveQuantity, setDefectiveQuantity] = useState(1);
  const [state, setState] = useState(initialState);
  const [stationId, setStationId] = useState(initialStationId);
  const [destination, setDestination] = useState("");
  const [address, setAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [memo, setMemo] = useState("");
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const hsIssueSelected = domain === "FIELD" && fieldItems.some((item) => item.transactionType === "HS_ISSUE");
  const requiredPhotos = domain === "FIELD" && fieldItems.some((item) => item.transactionType === "FIELD_USE" && data.fieldModels.find((model) => model.id === item.modelId)?.materialKind === "ACTIVE");
  const optionalOutdoorPhotos = domain === "FIELD" && fieldItems.some((item) => item.transactionType === "FIELD_USE" && data.fieldModels.find((model) => model.id === item.modelId)?.categoryName === "수동소자(옥외용)");
  const showPhotos = requiredPhotos || optionalOutdoorPhotos;
  const incompletePhotoPair = Boolean(beforeFile) !== Boolean(afterFile);
  const activeReplacementItem = fieldItems.find((item) => item.transactionType === "FIELD_USE" && data.fieldModels.find((model) => model.id === item.modelId)?.materialKind === "ACTIVE");
  const fieldDefectiveCategories = data.categories.filter((category) => category.active && activeFieldModels.some((model) => model.categoryId === category.id));
  const fieldDefectiveModels = activeFieldModels.filter((model) => model.categoryId === fieldDefectiveCategoryId);
  const toggleFieldDefective = (checked: boolean) => {
    setIncludeFieldDefective(checked);
    if (!checked || !activeReplacementItem) return;
    const usedModel = activeFieldModels.find((model) => model.id === activeReplacementItem.modelId);
    const categoryId = usedModel?.categoryId || fieldDefectiveCategories[0]?.id || "";
    setFieldDefectiveCategoryId(categoryId);
    setFieldDefectiveModelId(usedModel?.id || activeFieldModels.find((model) => model.categoryId === categoryId)?.id || "");
    setFieldDefectiveQuantity(activeReplacementItem.quantity);
  };
  useEffect(() => {
    if (hsIssueSelected && !hsIssueLocations.includes(address as typeof hsIssueLocations[number])) setAddress(hsIssueLocations[0]);
  }, [address, hsIssueSelected]);
  const updateFieldItem = (key: string, patch: Partial<FieldLine>) => setFieldItems((items) => items.map((item) => item.key === key ? { ...item, ...patch } : item));
  const requiredStockKey = (transactionType: string, selectedState: string) =>
    transactionType === "REPAIR_OUT" || transactionType === "DISPOSAL"
      ? "defectiveQuantity"
      : transactionType === "REPAIR_COMPLETE" || transactionType === "REPAIR_UNREPAIRABLE"
        ? "inRepairQuantity"
        : transactionType === "USE"
          ? selectedState === "NEW" ? "newQuantity" : "serviceableQuantity"
        : null;
  const eligibleSpareModels = (transactionType: string, selectedStationId: string, selectedState: string) => {
    const stockKey = requiredStockKey(transactionType, selectedState);
    if (!stockKey) return activeSpareModels;
    const availableModelIds = new Set(
      data.stationBalances
        .filter((balance) => balance.stationId === selectedStationId && Number(balance[stockKey]) > 0)
        .map((balance) => balance.modelId),
    );
    return activeSpareModels.filter((item) => availableModelIds.has(item.id));
  };
  const selectFirstEligibleModel = (transactionType: string, selectedStationId: string, selectedState: string) => {
    const next = eligibleSpareModels(transactionType, selectedStationId, selectedState)[0];
    setManufacturer(next?.manufacturer || "");
    setItemType(next?.itemType || "");
    setModelId(next?.id || "");
  };
  const selectableSpareModels = eligibleSpareModels(type, stationId, state);
  const spareManufacturers = [...new Set(selectableSpareModels.map((item) => item.manufacturer))].sort((a,b)=>a.localeCompare(b,"ko"));
  const spareItemTypes = [...new Set(selectableSpareModels.filter((item)=>item.manufacturer===manufacturer).map((item)=>item.itemType))].sort((a,b)=>a.localeCompare(b,"ko"));
  const spareModelOptions = selectableSpareModels.filter((item)=>item.manufacturer===manufacturer&&item.itemType===itemType);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let beforePhoto, afterPhoto;
    if (showPhotos && beforeFile && afterFile) {
      beforePhoto = await compressInventoryPhoto(beforeFile);
      afterPhoto = await compressInventoryPhoto(afterFile);
    }
    if (requiredPhotos && (!beforeFile || !afterFile)) return;
    if (incompletePhotoPair) return;
    if (domain === "FIELD") {
      if (requiredPhotos && includeFieldDefective && (!fieldDefectiveModelId || !Number.isInteger(fieldDefectiveQuantity) || fieldDefectiveQuantity < 1)) return;
      const items = fieldItems.map((item) => ({
        transactionType: item.transactionType,
        modelId: item.modelId,
        quantity: item.quantity,
        stockState: ["RECOVERED_BAD", "REPAIR_OUT", "DISPOSAL"].includes(item.transactionType) ? "BAD" : "NORMAL",
        companyName: item.transactionType === "HS_ISSUE" ? "H&S" : item.transactionType === "OTHER_COMPANY_ISSUE" ? "타사" : undefined,
        idempotencyKey: requestKey(),
      }));
      if (requiredPhotos && includeFieldDefective) {
        items.push({
          transactionType: "RECOVERED_BAD",
          modelId: fieldDefectiveModelId,
          quantity: fieldDefectiveQuantity,
          stockState: "BAD",
          companyName: undefined,
          idempotencyKey: requestKey(),
        });
      }
      await onSubmit({
        effectiveDate: date,
        location: address,
        purpose,
        workDetails: purpose,
        reason: purpose,
        beforePhoto,
        afterPhoto,
        sourceWorkerId: workerId,
        idempotencyKey: requestKey(),
        items,
      });
      return;
    }
    if (type === "USE" && includeDefective) {
      await onSubmit({
        effectiveDate: date,
        stationId,
        sourceStationId: stationId,
        purpose: purpose || undefined,
        workDetails: purpose || undefined,
        memo: memo || undefined,
        reason: purpose || undefined,
        idempotencyKey: requestKey(),
        items: [
          { transactionType: "USE", modelId, quantity, stockState: state, fromState: state, idempotencyKey: requestKey() },
          { transactionType: "RECOVERED_DEFECTIVE", modelId, quantity: defectiveQuantity, stockState: "DEFECTIVE", fromState: "DEFECTIVE", idempotencyKey: requestKey() },
        ],
      });
      return;
    }
    await onSubmit({
      transactionType: type,
      effectiveDate: date,
      modelId,
      quantity,
      stockState: state,
      fromState: state,
      stationId,
      sourceStationId: stationId,
      destinationStationId: destination || undefined,
      companyName: companyName || undefined,
      vendorName: companyName || undefined,
      purpose: purpose || undefined,
      workDetails: purpose || undefined,
      memo: memo || undefined,
      reason: purpose || undefined,
      beforePhoto,
      afterPhoto,
      idempotencyKey: requestKey(),
    });
  };
  return (
    <ModalShell
      title={
        domain === "FIELD" ? "유지보수 자재사용 등록" : "국사 예비품 관리 등록"
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <Field label="거래일자">
          <input
            className={inputClass}
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {domain === "FIELD" ? <Field label="작업자"><select aria-label="작업자" className={inputClass} required value={workerId} disabled={data.workers.length<=1} onChange={(e)=>setWorkerId(e.target.value)}><option value="">선택</option>{data.workers.map((worker)=><option key={worker.id} value={worker.id}>{worker.regionName ? `${worker.regionName} · ` : ""}{worker.name}</option>)}</select><span className="text-xs text-slate-500">{data.workers.length<=1 ? "매니저 계정은 본인으로 고정됩니다." : "권한 범위 내 작업자를 선택할 수 있습니다."}</span></Field> : null}
        {domain === "FIELD" ? (
          <div className="space-y-3 sm:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-black text-[#173B57]">사용·회수 자재</div>
                <div className="text-xs text-slate-500">같은 주소와 작업내용에 사용할 자재를 여러 개 등록할 수 있습니다.</div>
              </div>
              <button type="button" onClick={() => setFieldItems((items) => [...items, makeFieldLine()])} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
                <Plus className="h-4 w-4" /> 추가 등록
              </button>
            </div>
            {fieldItems.map((item, index) => (
              <div key={item.key} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12">
                <label className="space-y-1 sm:col-span-3"><span className="text-xs font-bold text-slate-600">거래유형</span><select aria-label={`거래유형 ${index + 1}`} className={inputClass} value={item.transactionType} onChange={(e) => { const transactionType=e.target.value; const categories=eligibleFieldCategories(transactionType); const categoryId=categories.some((category)=>category.id===item.categoryId)?item.categoryId:(categories[0]?.id||""); const models=eligibleFieldModels(transactionType,categoryId); updateFieldItem(item.key,{transactionType,categoryId,modelId:models.some((model)=>model.id===item.modelId)?item.modelId:(models[0]?.id||"")}); }}>{allowed.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="space-y-1 sm:col-span-3"><span className="text-xs font-bold text-slate-600">품목</span><select aria-label={`품목 ${index + 1}`} className={inputClass} value={item.categoryId} onChange={(e) => { const categoryId=e.target.value; updateFieldItem(item.key,{categoryId,modelId:eligibleFieldModels(item.transactionType,categoryId)[0]?.id||""}); }}><option value="">선택</option>{eligibleFieldCategories(item.transactionType).map((category)=><option key={category.id} value={category.id}>{category.categoryName}</option>)}</select></label>
                <label className="space-y-1 sm:col-span-4"><span className="text-xs font-bold text-slate-600">세부모델</span><select aria-label={`세부모델 ${index + 1}`} required className={inputClass} value={item.modelId} onChange={(e)=>updateFieldItem(item.key,{modelId:e.target.value})}><option value="">선택</option>{eligibleFieldModels(item.transactionType,item.categoryId).map((model)=><option key={model.id} value={model.id}>{model.modelName}</option>)}</select></label>
                <label className="space-y-1 sm:col-span-2"><span className="text-xs font-bold text-slate-600">수량</span><div className="flex gap-1"><input aria-label={`수량 ${index + 1}`} className={inputClass} type="number" min="1" step="1" required value={item.quantity} onChange={(e)=>updateFieldItem(item.key,{quantity:Number(e.target.value)})}/>{fieldItems.length>1?<button type="button" aria-label={`${index+1}번째 자재 삭제`} onClick={()=>setFieldItems((items)=>items.filter((line)=>line.key!==item.key))} className="rounded-lg border border-red-200 px-2 text-red-600"><X className="h-4 w-4"/></button>:null}</div></label>
              </div>
            ))}
            {requiredPhotos ? (
              <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-extrabold text-red-700">
                  <input aria-label="불량품 회수등록" type="checkbox" checked={includeFieldDefective} onChange={(event) => toggleFieldDefective(event.target.checked)} />
                  불량품 회수등록
                </label>
                {includeFieldDefective ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="회수품 품목">
                      <select aria-label="회수품 품목" className={inputClass} required value={fieldDefectiveCategoryId} onChange={(event) => { const categoryId=event.target.value; setFieldDefectiveCategoryId(categoryId); setFieldDefectiveModelId(activeFieldModels.find((model) => model.categoryId === categoryId)?.id || ""); }}>
                        <option value="">선택</option>
                        {fieldDefectiveCategories.map((category) => <option key={category.id} value={category.id}>{category.categoryName}</option>)}
                      </select>
                    </Field>
                    <Field label="회수품 세부모델">
                      <select aria-label="회수품 세부모델" className={inputClass} required value={fieldDefectiveModelId} onChange={(event) => setFieldDefectiveModelId(event.target.value)}>
                        <option value="">선택</option>
                        {fieldDefectiveModels.map((model) => <option key={model.id} value={model.id}>{model.modelName}</option>)}
                      </select>
                    </Field>
                    <Field label="회수 수량"><input aria-label="회수 수량" className={inputClass} type="number" min="1" step="1" required value={fieldDefectiveQuantity} onChange={(event) => setFieldDefectiveQuantity(Number(event.target.value))} /></Field>
                    <p className="text-xs text-red-600 sm:col-span-3">사용 자재의 품목·모델·수량이 기본값으로 입력되며 현장에서 모두 변경할 수 있습니다.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <Field label="거래유형"><select className={inputClass} value={type} onChange={(e) => {
              const nextType=e.target.value;
              setType(nextType);
              let nextState=state;
              if (nextType==="REPAIR_OUT"||nextType==="DISPOSAL") nextState="DEFECTIVE";
              if (nextType==="REPAIR_COMPLETE"||nextType==="REPAIR_UNREPAIRABLE") nextState="IN_REPAIR";
              if (nextType==="USE"&&!['NEW','SERVICEABLE'].includes(nextState)) nextState="SERVICEABLE";
              setState(nextState);
              selectFirstEligibleModel(nextType,stationId,nextState);
            }}>{allowed.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="제조사">
              <select
                aria-label="예비품 제조사"
                className={inputClass}
                required
                value={manufacturer}
                onChange={(e)=>{
                  const nextManufacturer=e.target.value;
                  const next=selectableSpareModels.find((item)=>item.manufacturer===nextManufacturer);
                  setManufacturer(nextManufacturer);
                  setItemType(next?.itemType||"");
                  setModelId(next?.id||"");
                }}
              >
                <option value="">선택</option>
                {spareManufacturers.map((item)=><option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="품명">
              <select
                aria-label="예비품 품명"
                className={inputClass}
                required
                value={itemType}
                onChange={(e)=>{
                  const nextItemType=e.target.value;
                  const next=selectableSpareModels.find((item)=>item.manufacturer===manufacturer&&item.itemType===nextItemType);
                  setItemType(nextItemType);
                  setModelId(next?.id||"");
                }}
              >
                <option value="">선택</option>
                {spareItemTypes.map((item)=><option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="모델">
              <select aria-label="예비품 모델" className={inputClass} required value={modelId} onChange={(e)=>setModelId(e.target.value)}>
                <option value="">선택</option>
                {!spareModelOptions.length ? <option value="" disabled>선택 가능한 재고 없음</option> : null}
                {spareModelOptions.map((item)=><option key={item.id} value={item.id}>{item.modelName}</option>)}
              </select>
            </Field>
            <Field label="수량"><input className={inputClass} type="number" min="1" step="1" required value={quantity} onChange={(e)=>setQuantity(Number(e.target.value))}/></Field>
          </>
        )}
        {domain === "STATION" ? (
          <>
            <Field label="국사">
              <select
                className={inputClass}
                value={stationId}
                onChange={(e) => {
                  const nextStationId=e.target.value;
                  setStationId(nextStationId);
                  selectFirstEligibleModel(type,nextStationId,state);
                }}
              >
                {data.stations
                  .filter((i) => i.active)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.regionName} · {i.stationName}
                    </option>
                  ))}
              </select>
            </Field>
            {type === "TRANSFER" ? (
              <Field label="도착 국사">
                <select
                  className={inputClass}
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">선택</option>
                  {data.stations
                    .filter((i) => i.active && i.id !== stationId)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.regionName} · {i.stationName}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
            <Field
              label={
                type === "DEFECT_CONVERSION" ? "불량 발생 전 상태" : "재고상태"
              }
            >
              <select
                className={inputClass}
                value={state}
                disabled={["REPAIR_OUT","REPAIR_COMPLETE","REPAIR_UNREPAIRABLE","DISPOSAL"].includes(type)}
                onChange={(e) => {
                  const nextState=e.target.value;
                  setState(nextState);
                  if(type==="USE") selectFirstEligibleModel(type,stationId,nextState);
                }}
              >
                {(type === "DEFECT_CONVERSION"
                  ? ["NEW", "SERVICEABLE"]
                  : type === "USE"
                    ? ["NEW", "SERVICEABLE"]
                  : ["NEW", "SERVICEABLE", "DEFECTIVE", "IN_REPAIR"]
                ).map((i) => (
                  <option key={i} value={i}>
                    {stateLabels[i]}
                  </option>
                ))}
              </select>
            </Field>
            {type === "USE" ? (
              <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-extrabold text-red-700">
                  <input type="checkbox" checked={includeDefective} onChange={(e) => setIncludeDefective(e.target.checked)} />
                  사용과 함께 불량품 회수 등록
                </label>
                {includeDefective ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="회수품 제조사"><input aria-label="회수 불량품 제조사" className={inputClass} value={manufacturer} disabled /></Field>
                    <Field label="회수품 품명"><input aria-label="회수 불량품 품명" className={inputClass} value={itemType} disabled /></Field>
                    <Field label="회수품 모델"><input aria-label="회수 불량품 모델" className={inputClass} value={spareModelOptions.find((item)=>item.id===modelId)?.modelName||""} disabled /></Field>
                    <Field label="불량품 수량"><input className={inputClass} type="number" min="1" step="1" required value={defectiveQuantity} onChange={(e) => setDefectiveQuantity(Number(e.target.value))} /></Field>
                    <p className="text-xs text-red-600 sm:col-span-2">예비품 사용 수량과 회수 불량품 수량을 한 번에 원장에 반영합니다. 사진 등록은 필요하지 않습니다.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <Field label="주소" wide>
            {hsIssueSelected ? (
              <select aria-label="H&S 분출 지점" className={inputClass} required value={address} onChange={(e)=>setAddress(e.target.value)}>
                {hsIssueLocations.map((location)=><option key={location} value={location}>{location}</option>)}
              </select>
            ) : (
              <input
                className={inputClass}
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="설치장소 또는 작업주소"
              />
            )}
          </Field>
        )}
        {domain === "STATION" && type === "REPAIR_OUT" ? (
          <Field label={type === "REPAIR_OUT" ? "수리업체" : "대상 회사"}>
            <input
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label={domain === "FIELD" ? "작업내용 / 사유" : "처리내용 / 사유"} wide>
          <textarea
            className="min-h-20 w-full rounded-xl border bg-slate-50 p-3 text-sm"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>
        {showPhotos ? (
          <div className="grid gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 sm:col-span-2 sm:grid-cols-2">
            <PhotoInput
              label="전 사진"
              file={beforeFile}
              onChange={setBeforeFile}
            />
            <PhotoInput
              label="후 사진"
              file={afterFile}
              onChange={setAfterFile}
            />
            <p className="text-xs text-orange-700 sm:col-span-2">
              {requiredPhotos ? "능동자재가 포함된 작업은 전·후 사진이 모두 필요합니다." : "수동소자(옥외용) 전·후 사진은 선택사항이며, 등록할 때는 두 장을 함께 선택해야 합니다."} 회전 보정, 축소, JPEG 변환 및 EXIF 제거 후 전송합니다.
            </p>
          </div>
        ) : null}
        {domain === "STATION" ? (
          <Field label="비고" wide>
            <input
              className={inputClass}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2 border-t pt-4 sm:col-span-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2.5 font-bold"
          >
            취소
          </button>
          <button
            disabled={
              busy ||
              (domain === "FIELD" && !workerId) ||
              (domain === "FIELD" ? fieldItems.some((item) => !item.modelId || !Number.isInteger(item.quantity) || item.quantity < 1) : (!modelId || !Number.isInteger(quantity) || quantity < 1)) ||
              (domain === "FIELD" && requiredPhotos && includeFieldDefective && (!fieldDefectiveModelId || !Number.isInteger(fieldDefectiveQuantity) || fieldDefectiveQuantity < 1)) ||
              (domain === "STATION" && type === "USE" && includeDefective && (!Number.isInteger(defectiveQuantity) || defectiveQuantity < 1)) ||
              (requiredPhotos && (!beforeFile || !afterFile)) ||
              incompletePhotoPair
            }
            className="rounded-xl bg-[#C2410C] px-5 py-2.5 font-extrabold text-white disabled:opacity-50"
          >
            원장에 저장
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
const PhotoInput = ({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) => {
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <label className="group relative flex min-h-44 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-orange-300 bg-white p-3 text-center">
      {previewUrl ? <img src={previewUrl} alt={`${label} 미리보기`} className="absolute inset-0 h-full w-full object-contain" /> : <Images className="mb-2 h-8 w-8 text-orange-500" />}
      <span className={`relative z-10 rounded-lg px-2 py-1 text-sm font-extrabold ${previewUrl ? "bg-black/65 text-white" : ""}`}>{label}</span>
      <span className={`relative z-10 mt-1 max-w-full truncate rounded px-2 py-0.5 text-xs ${previewUrl ? "bg-black/65 text-white" : "text-slate-500"}`}>
        {file?.name || "갤러리에서 사진 선택"}
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
};
const FieldModelModal = ({
  data,
  model,
  busy,
  onClose,
  onSubmit,
}: {
  data: InventoryBootstrap;
  model?: FieldMaterialModel;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    categoryId?: string;
    categoryName?: string;
    modelName: string;
    quantity: number;
    unit: string;
    materialKind: "ACTIVE" | "PASSIVE";
  }) => Promise<void>;
}) => {
  const activeCategories = data.categories.filter((item) => item.active);
  const customCategoryValue = "__CUSTOM__";
  const [categoryChoice, setCategoryChoice] = useState(model?.categoryId || "");
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [modelName, setModelName] = useState(model?.modelName || "");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState(model?.unit || "EA");
  const [kind, setKind] = useState<"ACTIVE" | "PASSIVE">(model?.materialKind || "PASSIVE");
  return (
    <ModalShell title={model ? "현장 자재 기준정보 수정" : "현장 자재 모델 등록"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const categoryName = categoryChoice === customCategoryValue
            ? customCategoryName.trim()
            : activeCategories.find((item) => item.id === categoryChoice)?.categoryName || "";
          const existingCategory = data.categories.find((item) => item.active && item.categoryName.toLocaleLowerCase() === categoryName.trim().toLocaleLowerCase());
          void onSubmit({
            categoryId: existingCategory?.id,
            categoryName: categoryName.trim(),
            modelName,
            quantity,
            unit,
            materialKind: kind,
          });
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <Field label="품명">
          <select aria-label="현장 자재 품명" className={inputClass} required value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)}>
            <option value="">등록된 품명 선택</option>
            {activeCategories.map((item) => <option key={item.id} value={item.id}>{item.categoryName}</option>)}
            <option value={customCategoryValue}>새 품명 직접 입력</option>
          </select>
          {categoryChoice === customCategoryValue ? (
            <input aria-label="새 현장 자재 품명" className={`${inputClass} mt-2`} required value={customCategoryName} onChange={(e) => setCustomCategoryName(e.target.value)} placeholder="새 품명을 입력하세요" />
          ) : null}
        </Field>
        <Field label="세부모델">
          <input
            className={inputClass}
            required
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
          />
        </Field>
        {!model ? <Field label="수량">
          <input
            className={inputClass}
            type="number"
            min="1"
            step="1"
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </Field> : null}
        <Field label="단위">
          <input
            className={inputClass}
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>
        <Field label="능동/수동">
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as "ACTIVE" | "PASSIVE")}
          >
            <option value="PASSIVE">수동</option>
            <option value="ACTIVE">능동</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-4 sm:col-span-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2"
          >
            취소
          </button>
          <button
            disabled={busy}
            className="rounded-xl bg-[#173B57] px-5 py-2 font-bold text-white"
          >
            {model ? "수정 저장" : "등록"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
const SpareModelModal = ({
  model,
  busy,
  onClose,
  onSubmit,
}: {
  model?: SpareModel;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    manufacturer: string;
    itemType: string;
    modelName: string;
    unit: string;
  }) => Promise<void>;
}) => {
  const [manufacturer, setManufacturer] = useState(model?.manufacturer || "");
  const [itemType, setItemType] = useState(model?.itemType || "");
  const [modelName, setModelName] = useState(model?.modelName || "");
  const [unit, setUnit] = useState(model?.unit || "EA");
  return (
    <ModalShell title={model ? "국사 예비품 기준정보 수정" : "국사 예비품 모델 등록"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ manufacturer, itemType, modelName, unit });
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <Field label="제조사">
          <input
            className={inputClass}
            required
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
          />
        </Field>
        <Field label="품목">
          <input
            className={inputClass}
            required
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
          />
        </Field>
        <Field label="모델명">
          <input
            className={inputClass}
            required
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
          />
        </Field>
        <Field label="단위">
          <input
            className={inputClass}
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-4 sm:col-span-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2"
          >
            취소
          </button>
          <button
            disabled={busy}
            className="rounded-xl bg-[#173B57] px-5 py-2 font-bold text-white"
          >
            {model ? "수정 저장" : "등록"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
const ExportButton = ({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
  >
    <Download className="h-4 w-4" />
    {label}
  </button>
);
