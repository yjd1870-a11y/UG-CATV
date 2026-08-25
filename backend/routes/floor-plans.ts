import fs from 'node:fs';
import { Router } from 'express';
import { db } from '../db';
import { normalizeLookupValue, normalizeStationName } from '../catv';
import { imageMimeType, readFloorPlanObject, resolveFloorPlanObject } from '../floor-plan-storage';
import { ApiError, asyncRoute, success } from '../http';
import { requireAuth } from '../security/session';
import { usesR2Storage } from '../object-storage';

const router = Router();
router.use(requireAuth);

type FloorPlanRow = {
  id: string;
  station_name: string;
  station_key: string;
  plan_order: number;
  file_name: string;
  image_url: string | null;
  object_key: string | null;
  width: number | null;
  height: number | null;
};

router.get('/search', (req, res) => {
  const stationName = typeof req.query.station === 'string' ? req.query.station.trim() : '';
  const target = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  const type = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : 'node';
  const equipment = typeof req.query.equipment === 'string' ? req.query.equipment.trim() : '';
  const requestedPlanId = typeof req.query.planId === 'string' ? req.query.planId.trim() : '';
  if (!stationName) throw new ApiError(400, '국사명을 입력해주세요.', 'VALIDATION_ERROR');

  const stationKey = normalizeStationName(stationName);
  const plans = db.prepare('SELECT * FROM catv_floor_plans WHERE station_key = ? ORDER BY plan_order, created_at, id')
    .all(stationKey) as FloorPlanRow[];
  if (!plans.length) {
    throw new ApiError(404, `${stationName} 평면도가 등록되어 있지 않습니다.`, 'FLOOR_PLAN_NOT_FOUND');
  }

  const coordinates = db.prepare(`
    SELECT floor_plan_id, label, node_name, rack_name, equipment_type, x_ratio, y_ratio
      FROM catv_floor_plan_coordinates
     WHERE floor_plan_id IN (SELECT id FROM catv_floor_plans WHERE station_key = ?)
  `).all(stationKey) as Array<Record<string, unknown>>;
  const targetKey = normalizeLookupValue(target);
  const equipmentKey = normalizeLookupValue(equipment);
  const valuesFor = (row: Record<string, unknown>) => [row.label, row.node_name, row.rack_name]
    .map(normalizeLookupValue)
    .filter(Boolean);
  const exactCandidates = coordinates.filter((row) => {
    const preferred = type === 'rack' ? normalizeLookupValue(row.rack_name) : normalizeLookupValue(row.node_name);
    return targetKey && (preferred === targetKey || valuesFor(row).includes(targetKey));
  });
  const partialCandidates = !exactCandidates.length && targetKey.length >= 4
    ? coordinates.filter((row) => valuesFor(row).some((value) => value.length >= 4 && (value.includes(targetKey) || targetKey.includes(value))))
    : [];
  const candidates = exactCandidates.length ? exactCandidates : partialCandidates;
  const equipmentMatches = equipmentKey
    ? candidates.filter((row) => !row.equipment_type || normalizeLookupValue(row.equipment_type).includes(equipmentKey))
    : candidates;
  const matches = equipmentMatches.length ? equipmentMatches : candidates;
  const requestedPlan = requestedPlanId ? plans.find((entry) => entry.id === requestedPlanId) : undefined;
  const automaticallyMatchedPlan = matches.length
    ? plans.find((entry) => entry.id === String(matches[0].floor_plan_id))
    : undefined;
  const plan = requestedPlan || automaticallyMatchedPlan || plans[0];
  const matched = matches.find((entry) => String(entry.floor_plan_id) === plan.id);
  const planSummary = (entry: FloorPlanRow) => ({
    id: entry.id,
    planOrder: Number(entry.plan_order),
    displayName: `도면 ${Number(entry.plan_order)}`,
    fileName: entry.file_name,
    imageUrl: `/api/floor-plans/${encodeURIComponent(entry.id)}/image`,
  });

  success(res, {
    floorPlan: {
      ...planSummary(plan),
      stationName: plan.station_name,
      width: plan.width,
      height: plan.height,
    },
    target: matched ? {
      label: String(matched.label || target),
      xRatio: Number(matched.x_ratio),
      yRatio: Number(matched.y_ratio),
      equipmentType: String(matched.equipment_type || equipment),
    } : null,
    requestedTarget: target,
    plans: plans.map(planSummary),
    matches: matches.map((entry) => {
      const matchedPlan = plans.find((candidate) => candidate.id === String(entry.floor_plan_id));
      return {
        floorPlanId: String(entry.floor_plan_id),
        planOrder: Number(matchedPlan?.plan_order || 1),
        displayName: `도면 ${Number(matchedPlan?.plan_order || 1)}`,
        label: String(entry.label || target),
        xRatio: Number(entry.x_ratio),
        yRatio: Number(entry.y_ratio),
        equipmentType: String(entry.equipment_type || equipment),
      };
    }),
  });
});

router.get('/:id/image', asyncRoute(async (req, res) => {
  const plan = db.prepare('SELECT * FROM catv_floor_plans WHERE id = ?').get(req.params.id) as FloorPlanRow | undefined;
  if (!plan) throw new ApiError(404, '평면도 이미지를 찾을 수 없습니다.', 'NOT_FOUND');
  if (plan.object_key) {
    if (usesR2Storage) {
      const object = await readFloorPlanObject(plan.object_key);
      res.type(object.contentType || imageMimeType(plan.file_name));
      res.setHeader('Content-Length', String(object.size));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (object.etag) res.setHeader('ETag', object.etag);
      res.send(object.body);
      return;
    }
    const absolutePath = resolveFloorPlanObject(plan.object_key);
    if (!fs.existsSync(absolutePath)) throw new ApiError(404, '평면도 이미지 파일을 찾을 수 없습니다.', 'NOT_FOUND');
    res.type(imageMimeType(plan.file_name));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(absolutePath);
    return;
  }
  if (plan.image_url) {
    res.redirect(plan.image_url);
    return;
  }
  throw new ApiError(404, '평면도 이미지가 등록되어 있지 않습니다.', 'NOT_FOUND');
}));

export default router;
