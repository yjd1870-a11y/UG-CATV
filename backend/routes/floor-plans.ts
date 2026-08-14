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
  if (!stationName) throw new ApiError(400, '국사명을 입력해주세요.', 'VALIDATION_ERROR');

  const stationKey = normalizeStationName(stationName);
  const plan = db.prepare('SELECT * FROM catv_floor_plans WHERE station_key = ? LIMIT 1').get(stationKey) as FloorPlanRow | undefined;
  if (!plan) {
    throw new ApiError(404, `${stationName} 평면도가 등록되어 있지 않습니다.`, 'FLOOR_PLAN_NOT_FOUND');
  }

  const coordinates = db.prepare(`
    SELECT label, node_name, rack_name, equipment_type, x_ratio, y_ratio
      FROM catv_floor_plan_coordinates WHERE floor_plan_id = ?
  `).all(plan.id) as Array<Record<string, unknown>>;
  const targetKey = normalizeLookupValue(target);
  const equipmentKey = normalizeLookupValue(equipment);
  const valuesFor = (row: Record<string, unknown>) => [row.label, row.node_name, row.rack_name]
    .map(normalizeLookupValue)
    .filter(Boolean);
  const exact = coordinates.find((row) => {
    const preferred = type === 'rack' ? normalizeLookupValue(row.rack_name) : normalizeLookupValue(row.node_name);
    const equipmentMatches = !equipmentKey || !row.equipment_type || normalizeLookupValue(row.equipment_type).includes(equipmentKey);
    return equipmentMatches && (preferred === targetKey || valuesFor(row).includes(targetKey));
  });
  const partial = !exact && targetKey.length >= 4
    ? coordinates.find((row) => valuesFor(row).some((value) => value.length >= 4 && (value.includes(targetKey) || targetKey.includes(value))))
    : undefined;
  const matched = exact || partial;

  success(res, {
    floorPlan: {
      id: plan.id,
      stationName: plan.station_name,
      fileName: plan.file_name,
      imageUrl: `/api/floor-plans/${encodeURIComponent(plan.id)}/image`,
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
