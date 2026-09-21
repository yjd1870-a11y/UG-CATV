import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { ApiError, asPositiveInteger, asText, asyncRoute, optionalText, success } from '../http';
import {
  createFieldTransaction,
  createStationTransaction,
  deleteFieldTransaction,
  elevatedRoles,
  getTransaction,
  getVisibleTransaction,
  getFieldIssueDetails,
  getFieldStatisticMeta,
  getFieldUsageItemStatistics,
  getFieldUsageStatistics,
  importOfficialFieldRows,
  importStationInventoryRows,
  listAssignableFieldWorkers,
  listFieldBalances,
  listSpareBalances,
  listTransactions,
  reverseTransaction,
  updateFieldTransaction,
  updateFieldTransactionQuantity,
} from '../inventory-service';
import {
  buildFieldOfficialWorkbook,
  buildFieldPhotoWorkbook,
  buildHsWorkbook,
  buildStationWorkbook,
  markPhotosExported,
} from '../inventory-excel';
import { removeMaterialPhoto, saveMaterialPhoto } from '../material-photo-storage';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { normalizeStationName } from '../catv';
import { writeAuditLog } from '../security/audit';
import { env } from '../env';

const router = Router();
router.use(requireAuth);
router.use((_req, _res, next) => {
  if (!env.materialManagementEnabled) {
    throw new ApiError(503, '자재관리 기능은 아직 운영에 공개되지 않았습니다.', 'MATERIAL_MANAGEMENT_DISABLED');
  }
  next();
});
const masterRoles = requireRoles('admin', 'public_official');
const importRoles = requireRoles('admin');
const exportRoles = requireRoles('admin', 'public_official');

const dateParam = (value: unknown, fallback: string) => {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new ApiError(400, '날짜 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
  return date;
};
const excelResponse = (res: Parameters<typeof success>[0], buffer: Buffer, filename: string) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(buffer);
};

router.get('/bootstrap', (req, res) => {
  const user = authUser(req);
  const fieldBalances = listFieldBalances();
  const stationBalances = listSpareBalances();
  success(res, {
    permissions: {
      canOperate: user.role !== 'guest',
      canManage: elevatedRoles.has(user.role),
      canFieldUse: user.role !== 'guest',
      canStationUse: user.role !== 'guest',
      canViewMaster: elevatedRoles.has(user.role),
      canImportExcel: user.role === 'admin',
      canExportExcel: user.role === 'admin' || user.role === 'public_official',
    },
    workers: listAssignableFieldWorkers(user),
    categories: db.prepare('SELECT id,category_name AS categoryName,sort_order AS sortOrder,active FROM field_material_categories ORDER BY sort_order,category_name').all(),
    fieldModels: db.prepare(`SELECT m.id,m.category_id AS categoryId,c.category_name AS categoryName,m.model_name AS modelName,m.manufacturer,m.unit,m.material_kind AS materialKind,m.notes,m.active FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id ORDER BY c.sort_order,m.model_name`).all(),
    fieldBalances,
    fieldTransactions: listTransactions(user, 'FIELD'),
    stations: db.prepare('SELECT id,region_name AS regionName,station_name AS stationName,normalized_key AS normalizedKey,sort_order AS sortOrder,active FROM spare_stations ORDER BY sort_order,station_name').all(),
    spareModels: db.prepare('SELECT id,manufacturer,item_type AS itemType,model_name AS modelName,unit,notes,active FROM spare_models ORDER BY item_type,manufacturer,model_name').all(),
    stationBalances,
    stationTransactions: listTransactions(user, 'STATION'),
    closures: db.prepare('SELECT id,period_key AS periodKey,period_start AS periodStart,period_end AS periodEnd,status,confirmed_at AS confirmedAt FROM inventory_month_closures ORDER BY period_start DESC').all(),
  });
});

router.get('/field/balances', (req, res) => success(res, listFieldBalances(typeof req.query.asOf === 'string' ? req.query.asOf : undefined)));
router.get('/field/transactions', (req, res) => success(res, listTransactions(authUser(req), 'FIELD', Number(req.query.limit || 300))));
router.get('/field/statistics/meta', (req, res) => success(res, getFieldStatisticMeta(authUser(req))));
router.get('/field/statistics', (req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  const start = dateParam(req.query.start, `${now.slice(0, 4)}-01-01`);
  const end = dateParam(req.query.end, now);
  if (start > end) throw new ApiError(400, '통계 시작일은 종료일보다 늦을 수 없습니다.', 'VALIDATION_ERROR');
  success(res, getFieldUsageStatistics(authUser(req), start, end, statisticFilters(req)));
});
const statisticFilters = (req: Parameters<typeof authUser>[0]) => ({
  regionName: typeof req.query.region === 'string' ? req.query.region.trim().slice(0, 100) || undefined : undefined,
  categoryName: typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 100) || undefined : undefined,
  modelName: typeof req.query.model === 'string' ? req.query.model.trim().slice(0, 200) || undefined : undefined,
  workerName: typeof req.query.worker === 'string' ? req.query.worker.trim().slice(0, 100) || undefined : undefined,
  issueOnly: req.query.issuesOnly === '1' || req.query.issuesOnly === 'true',
});
const statisticGroup = (value: unknown) => {
  const group = String(value || 'ALL').toUpperCase();
  if (!['ALL', 'WORKER', 'TEAM'].includes(group)) throw new ApiError(400, '통계 조회 구분이 올바르지 않습니다.', 'VALIDATION_ERROR');
  return group as 'ALL' | 'WORKER' | 'TEAM';
};
const statisticDetailParams = (req: Parameters<typeof authUser>[0]) => {
  const now = new Date().toISOString().slice(0, 10);
  const start = dateParam(req.query.start, `${now.slice(0, 4)}-01-01`);
  const end = dateParam(req.query.end, now);
  if (start > end) throw new ApiError(400, '통계 시작일은 종료일보다 늦을 수 없습니다.', 'VALIDATION_ERROR');
  const group = statisticGroup(req.query.group);
  const value = typeof req.query.value === 'string' ? req.query.value.trim().slice(0, 100) : '';
  if (group !== 'ALL' && !value) throw new ApiError(400, '개인 또는 팀을 선택해주세요.', 'VALIDATION_ERROR');
  return { start, end, group, value };
};
router.get('/field/statistics/items', (req, res) => {
  const { start, end, group, value } = statisticDetailParams(req);
  success(res, getFieldUsageItemStatistics(authUser(req), start, end, group, value, statisticFilters(req)));
});
router.get('/field/statistics/issues', (req, res) => {
  const { start, end, group, value } = statisticDetailParams(req);
  success(res, getFieldIssueDetails(authUser(req), start, end, group, value, statisticFilters(req)));
});
router.get('/station/balances', (req, res) => success(res, listSpareBalances(typeof req.query.asOf === 'string' ? req.query.asOf : undefined)));
router.get('/station/transactions', (req, res) => success(res, listTransactions(authUser(req), 'STATION', Number(req.query.limit || 300))));
router.get('/transactions/:id', (req, res) => success(res, getVisibleTransaction(authUser(req), req.params.id)));

router.post('/field/categories', masterRoles, (req, res) => {
  const id = randomUUID();
  const categoryName = asText(req.body?.categoryName, '품명', 100);
  const sortOrder = Number.isInteger(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0;
  db.prepare('INSERT INTO field_material_categories (id,category_name,sort_order) VALUES (?,?,?)').run(id,categoryName,sortOrder);
  writeAuditLog(req,{ action:'FIELD_MATERIAL_CATEGORY_CREATED',targetType:'field_material_category',targetId:id,metadata:{categoryName} });
  success(res,{id},201);
});

router.put('/field/categories/:id', masterRoles, (req, res) => {
  const categoryName = asText(req.body?.categoryName, '품명', 100);
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  const sortOrder = Number.isInteger(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0;
  const changed = db.prepare('UPDATE field_material_categories SET category_name=?,sort_order=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(categoryName,sortOrder,active,req.params.id);
  if (!changed.changes) throw new ApiError(404,'품명을 찾을 수 없습니다.','NOT_FOUND');
  writeAuditLog(req,{ action:'FIELD_MATERIAL_CATEGORY_UPDATED',targetType:'field_material_category',targetId:req.params.id,metadata:{categoryName,active,sortOrder} });
  success(res,{id:req.params.id});
});

router.post('/field/models', masterRoles, (req, res) => {
  const user=authUser(req);
  const id=randomUUID();
  const requestedCategoryId=optionalText(req.body?.categoryId,100);
  const requestedCategoryName=optionalText(req.body?.categoryName,100);
  const modelName=asText(req.body?.modelName,'세부모델',200);
  const unit=asText(req.body?.unit,'단위',20);
  const quantity=asPositiveInteger(req.body?.quantity,'수량');
  const materialKind=String(req.body?.materialKind || 'PASSIVE').toUpperCase();
  if(!['ACTIVE','PASSIVE'].includes(materialKind)) throw new ApiError(400,'능동/수동 구분이 올바르지 않습니다.','VALIDATION_ERROR');
  let category=db.prepare('SELECT id,category_name AS categoryName FROM field_material_categories WHERE id=? AND active=1').get(requestedCategoryId || '') as {id:string;categoryName:string}|undefined;
  if(!category && requestedCategoryName) category=db.prepare('SELECT id,category_name AS categoryName FROM field_material_categories WHERE category_name=? COLLATE NOCASE AND active=1').get(requestedCategoryName) as typeof category;
  const transactionId=randomUUID();
  const effectiveDate=new Date().toISOString().slice(0,10);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!category){
      const categoryName=asText(requestedCategoryName,'품명',100);
      category={id:randomUUID(),categoryName};
      db.prepare('INSERT INTO field_material_categories (id,category_name,sort_order) VALUES (?,?,999)').run(category.id,categoryName);
    }
    db.prepare('INSERT INTO field_material_models (id,category_id,model_name,manufacturer,unit,material_kind,notes) VALUES (?,?,?,?,?,?,?)')
      .run(id,category.id,modelName,'',unit,materialKind,optionalText(req.body?.notes,1000)||'');
    db.prepare(`INSERT INTO inventory_transactions (id,transaction_number,domain,transaction_type,effective_date,created_by,region_id,purpose,reason)
      VALUES (?,?,'FIELD','OPENING',?,?,?,'모델 등록 기초재고','모델 등록 기초재고')`)
      .run(transactionId,`FM-${effectiveDate.replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`,effectiveDate,user.id,user.regionId);
    db.prepare(`INSERT INTO field_material_entries (id,transaction_id,model_id,stock_state,signed_quantity,unit_snapshot,model_name_snapshot)
      VALUES (?,?,?,'NORMAL',?,?,?)`).run(randomUUID(),transactionId,id,quantity,unit,modelName);
    db.prepare(`INSERT INTO inventory_audit_logs (id,transaction_id,user_id,role,action,reason,after_json)
      VALUES (?,?,?,?,?,'모델 등록 기초재고',?)`).run(randomUUID(),transactionId,user.id,user.role,'FIELD_MODEL_WITH_OPENING_CREATED',JSON.stringify({categoryId:category.id,categoryName:category.categoryName,modelName,quantity,unit,materialKind}));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  writeAuditLog(req,{action:'FIELD_MATERIAL_MODEL_CREATED',targetType:'field_material_model',targetId:id,metadata:{categoryId:category.id,categoryName:category.categoryName,modelName,quantity,unit,materialKind}});
  success(res,{id,transactionId},201);
});

router.put('/field/models/:id', masterRoles, (req,res) => {
  const existingModel=db.prepare('SELECT id FROM field_material_models WHERE id=?').get(req.params.id);
  if(!existingModel) throw new ApiError(404,'모델을 찾을 수 없습니다.','NOT_FOUND');
  const requestedCategoryId=optionalText(req.body?.categoryId,100);
  const requestedCategoryName=optionalText(req.body?.categoryName,100);
  const modelName=asText(req.body?.modelName,'세부모델',200);
  const unit=asText(req.body?.unit,'단위',20);
  const materialKind=String(req.body?.materialKind || 'PASSIVE').toUpperCase();
  if(!['ACTIVE','PASSIVE'].includes(materialKind)) throw new ApiError(400,'능동/수동 구분이 올바르지 않습니다.','VALIDATION_ERROR');
  const active=req.body?.active===false||req.body?.active===0?0:1;
  let category=db.prepare('SELECT id,category_name AS categoryName FROM field_material_categories WHERE id=? AND active=1').get(requestedCategoryId || '') as {id:string;categoryName:string}|undefined;
  if(!category&&requestedCategoryName) category=db.prepare('SELECT id,category_name AS categoryName FROM field_material_categories WHERE category_name=? COLLATE NOCASE AND active=1').get(requestedCategoryName) as typeof category;
  if(!category){
    const categoryName=asText(requestedCategoryName,'품명',100);
    category={id:randomUUID(),categoryName};
    db.prepare('INSERT INTO field_material_categories (id,category_name,sort_order) VALUES (?,?,999)').run(category.id,categoryName);
  }
  const changed=db.prepare('UPDATE field_material_models SET category_id=?,model_name=?,manufacturer=?,unit=?,material_kind=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(category.id,modelName,optionalText(req.body?.manufacturer,100)||'',unit,materialKind,optionalText(req.body?.notes,1000)||'',active,req.params.id);
  if(!changed.changes) throw new ApiError(404,'모델을 찾을 수 없습니다.','NOT_FOUND');
  writeAuditLog(req,{action:'FIELD_MATERIAL_MODEL_UPDATED',targetType:'field_material_model',targetId:req.params.id,metadata:{categoryId:category.id,categoryName:category.categoryName,modelName,materialKind,active}});
  success(res,{id:req.params.id});
});

router.delete('/field/models/:id', masterRoles, (req,res) => {
  const model=db.prepare('SELECT id,model_name AS modelName,active FROM field_material_models WHERE id=?').get(req.params.id) as {id:string;modelName:string;active:number}|undefined;
  if(!model||!model.active) throw new ApiError(404,'사용 중인 현장 자재 모델을 찾을 수 없습니다.','NOT_FOUND');
  const quantity=Number((db.prepare(`SELECT COALESCE(SUM(ABS(balance)),0) AS quantity FROM (SELECT e.stock_state,SUM(e.signed_quantity) AS balance FROM field_material_entries e JOIN inventory_transactions t ON t.id=e.transaction_id WHERE e.model_id=? AND t.status='POSTED' GROUP BY e.stock_state)`).get(req.params.id) as {quantity:number}).quantity);
  if(quantity>0.000001) throw new ApiError(409,'현재고가 남아 있는 모델은 삭제할 수 없습니다. 재고를 0으로 조정한 후 삭제해주세요.','MODEL_HAS_STOCK');
  db.prepare('UPDATE field_material_models SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  writeAuditLog(req,{action:'FIELD_MATERIAL_MODEL_DEACTIVATED',targetType:'field_material_model',targetId:req.params.id,metadata:{modelName:model.modelName}});
  success(res,{id:req.params.id,deleted:true});
});

router.post('/station/stations', masterRoles, (req,res) => {
  const id=randomUUID();
  const regionName=asText(req.body?.regionName,'권역',100);
  const stationName=asText(req.body?.stationName,'국사명',100);
  const normalizedKey=normalizeStationName(stationName);
  const sortOrder=Number.isInteger(Number(req.body?.sortOrder))?Number(req.body.sortOrder):0;
  db.prepare('INSERT INTO spare_stations (id,region_name,station_name,normalized_key,sort_order) VALUES (?,?,?,?,?)').run(id,regionName,stationName,normalizedKey,sortOrder);
  writeAuditLog(req,{action:'SPARE_STATION_CREATED',targetType:'spare_station',targetId:id,metadata:{regionName,stationName,normalizedKey}});
  success(res,{id},201);
});

router.post('/station/models', masterRoles, (req,res) => {
  const id=randomUUID();
  const manufacturer=asText(req.body?.manufacturer,'제조사',100);
  const itemType=asText(req.body?.itemType,'품목',100);
  const modelName=asText(req.body?.modelName,'모델명',200);
  const unit=asText(req.body?.unit,'단위',20);
  db.prepare('INSERT INTO spare_models (id,manufacturer,item_type,model_name,unit,notes) VALUES (?,?,?,?,?,?)')
    .run(id,manufacturer,itemType,modelName,unit,optionalText(req.body?.notes,1000)||'');
  writeAuditLog(req,{action:'SPARE_MODEL_CREATED',targetType:'spare_model',targetId:id,metadata:{manufacturer,itemType,modelName}});
  success(res,{id},201);
});

router.put('/station/models/:id', masterRoles, (req,res) => {
  const manufacturer=asText(req.body?.manufacturer,'제조사',100);
  const itemType=asText(req.body?.itemType,'품목',100);
  const modelName=asText(req.body?.modelName,'모델명',200);
  const unit=asText(req.body?.unit,'단위',20);
  const active=req.body?.active===false||req.body?.active===0?0:1;
  const changed=db.prepare('UPDATE spare_models SET manufacturer=?,item_type=?,model_name=?,unit=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(manufacturer,itemType,modelName,unit,optionalText(req.body?.notes,1000)||'',active,req.params.id);
  if(!changed.changes) throw new ApiError(404,'모델을 찾을 수 없습니다.','NOT_FOUND');
  writeAuditLog(req,{action:'SPARE_MODEL_UPDATED',targetType:'spare_model',targetId:req.params.id,metadata:{manufacturer,itemType,modelName,active}});
  success(res,{id:req.params.id});
});

router.delete('/station/models/:id', masterRoles, (req,res) => {
  const model=db.prepare('SELECT id,model_name AS modelName,active FROM spare_models WHERE id=?').get(req.params.id) as {id:string;modelName:string;active:number}|undefined;
  if(!model||!model.active) throw new ApiError(404,'사용 중인 국사 예비품 모델을 찾을 수 없습니다.','NOT_FOUND');
  const quantity=Number((db.prepare(`SELECT COALESCE(SUM(ABS(balance)),0) AS quantity FROM (SELECT e.station_id,e.stock_state,SUM(e.signed_quantity) AS balance FROM spare_entries e JOIN inventory_transactions t ON t.id=e.transaction_id WHERE e.model_id=? AND t.status='POSTED' GROUP BY e.station_id,e.stock_state)`).get(req.params.id) as {quantity:number}).quantity);
  if(quantity>0.000001) throw new ApiError(409,'국사 재고가 남아 있는 모델은 삭제할 수 없습니다. 재고를 0으로 조정한 후 삭제해주세요.','MODEL_HAS_STOCK');
  db.prepare('UPDATE spare_models SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  writeAuditLog(req,{action:'SPARE_MODEL_DEACTIVATED',targetType:'spare_model',targetId:req.params.id,metadata:{modelName:model.modelName}});
  success(res,{id:req.params.id,deleted:true});
});

router.post('/field/transactions', asyncRoute(async (req,res) => {
  const user=authUser(req);
  const key=optionalText(req.body?.idempotencyKey,100);
  if(key){
    const existing=db.prepare('SELECT id FROM inventory_transactions WHERE created_by=? AND idempotency_key=?').get(user.id,key) as {id:string}|undefined;
    if(existing){success(res,getTransaction(existing.id));return;}
  }
  const model=db.prepare(`SELECT m.material_kind AS materialKind,c.category_name AS categoryName FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE m.id=?`).get(req.body?.modelId) as {materialKind:string;categoryName:string}|undefined;
  if(!model) throw new ApiError(404,'현장 자재 모델을 찾을 수 없습니다.','MODEL_NOT_FOUND');
  const transactionId=randomUUID();
  const saved=[] as Awaited<ReturnType<typeof saveMaterialPhoto>>[];
  try{
    const fieldUse=String(req.body?.transactionType).toUpperCase()==='FIELD_USE';
    const wantsPhotos=Boolean(req.body?.beforePhoto||req.body?.afterPhoto);
    if(fieldUse && (model.materialKind==='ACTIVE'||(model.categoryName==='수동소자(옥외용)'&&wantsPhotos))){
      saved.push(await saveMaterialPhoto(req.body?.beforePhoto,transactionId,'BEFORE'));
      saved.push(await saveMaterialPhoto(req.body?.afterPhoto,transactionId,'AFTER'));
    }
    success(res,createFieldTransaction(req,saved,transactionId),201);
  }catch(error){
    await Promise.allSettled(saved.flatMap((photo)=>[photo.objectKey, photo.thumbnailObjectKey]).map(removeMaterialPhoto));
    throw error;
  }
}));

router.post('/field/transactions/batch', asyncRoute(async (req,res) => {
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!items.length||items.length>30) throw new ApiError(400,'자재는 1~30개까지 함께 등록할 수 있습니다.','VALIDATION_ERROR');
  const originalBody=req.body;
  const transactionIds=items.map(()=>randomUUID());
  const savedByItem: Array<Awaited<ReturnType<typeof saveMaterialPhoto>>[]> = items.map(()=>[]);
  try{
    for(let index=0;index<items.length;index+=1){
      const item=items[index]&&typeof items[index]==='object'?items[index] as Record<string,unknown>:{};
      const model=db.prepare(`SELECT m.material_kind AS materialKind,c.category_name AS categoryName FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE m.id=? AND m.active=1`).get(String(item.modelId||'')) as {materialKind:string;categoryName:string}|undefined;
      if(!model) throw new ApiError(404,`${index+1}번째 현장 자재 모델을 찾을 수 없습니다.`,'MODEL_NOT_FOUND');
      const fieldUse=String(item.transactionType).toUpperCase()==='FIELD_USE';
      const wantsPhotos=Boolean(originalBody.beforePhoto||originalBody.afterPhoto);
      if(fieldUse&&(model.materialKind==='ACTIVE'||(model.categoryName==='수동소자(옥외용)'&&wantsPhotos))){
        savedByItem[index].push(await saveMaterialPhoto(originalBody.beforePhoto,transactionIds[index],'BEFORE'));
        savedByItem[index].push(await saveMaterialPhoto(originalBody.afterPhoto,transactionIds[index],'AFTER'));
      }
    }
    const results: unknown[]=[];
    db.exec('BEGIN IMMEDIATE');
    try{
      for(let index=0;index<items.length;index+=1){
        req.body={...originalBody,...items[index],beforePhoto:undefined,afterPhoto:undefined,idempotencyKey:items[index].idempotencyKey||`${originalBody.idempotencyKey||randomUUID()}:${index+1}`};
        results.push(createFieldTransaction(req,savedByItem[index],transactionIds[index],false));
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    success(res,{count:results.length,transactions:results},201);
  }catch(error){
    await Promise.allSettled(savedByItem.flat().flatMap((photo)=>[photo.objectKey, photo.thumbnailObjectKey]).map(removeMaterialPhoto));
    throw error;
  }finally{req.body=originalBody;}
}));

router.post('/station/transactions/batch',(req,res)=>{
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!items.length||items.length>30) throw new ApiError(400,'예비품은 1~30개까지 함께 등록할 수 있습니다.','VALIDATION_ERROR');
  const originalBody=req.body;
  const results:unknown[]=[];
  db.exec('BEGIN IMMEDIATE');
  try{
    for(let index=0;index<items.length;index+=1){
      req.body={...originalBody,...items[index],idempotencyKey:items[index]?.idempotencyKey||`${originalBody.idempotencyKey||randomUUID()}:${index+1}`};
      results.push(createStationTransaction(req,false));
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  finally{req.body=originalBody;}
  success(res,{count:results.length,transactions:results},201);
});
router.post('/station/transactions',(req,res)=>success(res,createStationTransaction(req),201));
router.post('/transactions/:id/reverse',masterRoles,(req,res)=>success(res,reverseTransaction(req),201));
router.put('/field/transactions/:id',masterRoles,(req,res)=>success(res,updateFieldTransaction(req)));
router.put('/field/transactions/:id/quantity',masterRoles,(req,res)=>success(res,updateFieldTransactionQuantity(req)));
router.delete('/field/transactions/:id',masterRoles,(req,res)=>success(res,deleteFieldTransaction(req)));

router.post('/field/imports/official',importRoles,(req,res)=>{
  if (!req.body?.sourceHash) req.body.sourceHash=createHash('sha256').update(JSON.stringify(req.body?.rows||[])).digest('hex');
  success(res,importOfficialFieldRows(req),201);
});

router.post('/station/imports/inventory',importRoles,(req,res)=>{
  if (!req.body?.sourceHash) req.body.sourceHash=createHash('sha256').update(JSON.stringify(req.body?.rows||[])).digest('hex');
  success(res,importStationInventoryRows(req),201);
});

router.post('/field/closures',masterRoles,(req,res)=>{
  const user=authUser(req);
  const periodKey=asText(req.body?.periodKey,'마감월',7);
  if(!/^\d{4}-\d{2}$/.test(periodKey)) throw new ApiError(400,'마감월 형식은 YYYY-MM이어야 합니다.','VALIDATION_ERROR');
  const start=dateParam(req.body?.periodStart,`${periodKey}-01`);
  const next=new Date(`${periodKey}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
  const end=dateParam(req.body?.periodEnd,next.toISOString().slice(0,10));
  const negative=(listFieldBalances(end) as Array<Record<string,unknown>>).filter((row)=>Number(row.normalQuantity)<0||Number(row.badQuantity)<0);
  if(negative.length) throw new ApiError(409,'음수재고가 있어 마감할 수 없습니다.','NEGATIVE_STOCK');
  const missing=Number((db.prepare(`SELECT COUNT(*) AS count FROM inventory_transactions t JOIN field_material_entries e ON e.transaction_id=t.id JOIN field_material_models m ON m.id=e.model_id WHERE t.domain='FIELD' AND t.status='POSTED' AND t.transaction_type='FIELD_USE' AND m.material_kind='ACTIVE' AND t.effective_date BETWEEN ? AND ? AND (SELECT COUNT(*) FROM material_photo_assets p WHERE p.transaction_id=t.id)<>2`).get(start,end) as {count:number}).count);
  if(missing) throw new ApiError(409,`능동자재 ${missing}건의 전·후 사진이 부족합니다.`,'ACTIVE_PHOTOS_REQUIRED');
  const pending=Number((db.prepare(`SELECT COUNT(*) AS count FROM material_photo_assets p JOIN inventory_transactions t ON t.id=p.transaction_id WHERE t.effective_date BETWEEN ? AND ? AND p.archive_status<>'EXPORTED'`).get(start,end) as {count:number}).count);
  if(pending) throw new ApiError(409,'사진 Excel을 먼저 생성하고 확인해야 합니다.','PHOTO_EXPORT_REQUIRED');
  const id=randomUUID();
  db.prepare('INSERT INTO inventory_month_closures (id,period_key,period_start,period_end,summary_json,confirmed_by) VALUES (?,?,?,?,?,?)')
    .run(id,periodKey,start,end,JSON.stringify({fieldBalances:listFieldBalances(end)}),user.id);
  writeAuditLog(req,{action:'INVENTORY_MONTH_CLOSED',targetType:'inventory_month_closure',targetId:id,metadata:{periodKey,start,end}});
  success(res,{id,periodKey,start,end},201);
});

router.post('/imports/stage',importRoles,(req,res)=>{
  const user=authUser(req);
  const domain=String(req.body?.domain||'').toUpperCase();
  if(!['FIELD','STATION'].includes(domain)) throw new ApiError(400,'이관 영역이 올바르지 않습니다.','VALIDATION_ERROR');
  const sourceFile=asText(req.body?.sourceFile,'원본 파일명',300);
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
  if(!rows.length||rows.length>10000) throw new ApiError(400,'이관 행은 1~10,000건이어야 합니다.','VALIDATION_ERROR');
  const sourceHash=typeof req.body?.sourceHash==='string'&&req.body.sourceHash?req.body.sourceHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const insert=db.prepare(`INSERT INTO inventory_import_rows (id,domain,source_file,source_hash,sheet_name,row_number,payload_json,status,issue_code,created_by) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_hash,sheet_name,row_number) DO NOTHING`);
  let review=0,inserted=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    rows.forEach((raw:unknown,index:number)=>{
      const row=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
      const sheetName=String(row.sheetName||req.body?.sheetName||'Sheet1');
      const rowNumber=Number(row.rowNumber||index+1);
      let issue:string|null=null;
      if(domain==='STATION'){
        const station=String(row.stationName||row['국사']||'');
        const model=String(row.modelName||row['모델명']||'');
        const quantity=Number(row.quantity??row['수량']);
        const memo=String(row.memo||row['비고']||'');
        if(!Number.isFinite(quantity)||quantity<=0) issue='MISSING_OR_ZERO_QUANTITY';
        if(station.includes('안성')&&model==='GX2-LM1000') issue='MIXED_STOCK_STATE';
        if(station.includes('수지')&&['GX2-PSAC10','GX2-RX200BX2'].includes(model)&&memo.includes('불량')) issue='EXTERNAL_DEFECTIVE_QUANTITY';
      }
      const result=insert.run(randomUUID(),domain,sourceFile,sourceHash,sheetName,rowNumber,JSON.stringify(row),issue?'REVIEW':'PENDING',issue,user.id);
      inserted+=Number(result.changes);if(issue)review+=1;
    });
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  success(res,{sourceHash,inserted,review},201);
});

router.get('/exports/field-official.xlsx',exportRoles,asyncRoute(async(req,res)=>{
  const year=Number(req.query.year||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2020||year>2100) throw new ApiError(400,'연도가 올바르지 않습니다.','VALIDATION_ERROR');
  excelResponse(res,await buildFieldOfficialWorkbook(year),`CATV_현장자재_공식보고_${year}.xlsx`);
}));
router.get('/exports/field-photos.xlsx',exportRoles,asyncRoute(async(req,res)=>{
  const today=new Date().toISOString().slice(0,10);const start=dateParam(req.query.start,today.slice(0,7)+'-01');const end=dateParam(req.query.end,today);
  const buffer=await buildFieldPhotoWorkbook(start,end);markPhotosExported(start,end);
  excelResponse(res,buffer,`CATV_능동자재_사진_${start}_${end}.xlsx`);
}));
router.get('/exports/hs.xlsx',exportRoles,asyncRoute(async(req,res)=>{
  const allHistory=req.query.scope==='all';
  const today=new Date().toISOString().slice(0,10);const start=dateParam(req.query.start,allHistory?'2000-01-01':today.slice(0,7)+'-01');const end=dateParam(req.query.end,allHistory?'2100-12-31':today);
  excelResponse(res,await buildHsWorkbook(start,end),allHistory?'CATV_HS분출_전체.xlsx':`CATV_HS분출_${start}_${end}.xlsx`);
}));
router.get('/exports/station.xlsx',exportRoles,asyncRoute(async(req,res)=>{
  const asOf=dateParam(req.query.asOf,new Date().toISOString().slice(0,10));
  excelResponse(res,await buildStationWorkbook(asOf),`CATV_국사예비품_${asOf}.xlsx`);
}));

export default router;
