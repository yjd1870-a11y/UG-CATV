import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { ApiError, asPositiveNumber, asText, optionalText, success } from '../http';
import { mapMaterialUsageRow } from '../mappers';
import { authUser, requireAuth, requireRoles } from '../security/session';

const router = Router();
router.use(requireAuth);
export const materialUsageRouter = Router();
materialUsageRouter.use(requireAuth);

const usageSelect = `
  SELECT mu.*, m.material_name, u.name AS worker_name, u.department, c.cell_name
    FROM material_usage mu
    JOIN materials m ON m.id = mu.material_id
    JOIN users u ON u.id = mu.user_id
    LEFT JOIN cells c ON c.id = mu.cell_id
   WHERE 1 = 1
`;

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, material_code AS materialCode, material_name AS materialName,
           specification, unit, stock_quantity AS stockQuantity,
           minimum_stock AS minimumStock, updated_at AS updatedAt
      FROM materials WHERE deleted_at IS NULL ORDER BY material_name
  `).all();
  success(res, rows);
});

router.post('/', requireRoles('admin'), (req, res) => {
  const id = randomUUID();
  const materialCode = asText(req.body?.materialCode, '자재코드', 50);
  const materialName = asText(req.body?.materialName, '자재명', 100);
  const unit = asText(req.body?.unit, '단위', 20);
  const stock = Math.max(0, Number(req.body?.stockQuantity || 0));
  const minimumStock = Math.max(0, Number(req.body?.minimumStock || 0));
  db.prepare(`
    INSERT INTO materials (
      id, material_code, material_name, specification, unit, stock_quantity, minimum_stock
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, materialCode, materialName, optionalText(req.body?.specification, 300), unit, stock, minimumStock);
  success(res, { id }, 201);
});

materialUsageRouter.get('/', (req, res) => {
  const user = authUser(req);
  const filters: string[] = [];
  const params: Array<string | number | null> = [];
  if (user.role === 'manager' || user.role === 'guest' || user.role === 'public_official') {
    filters.push('mu.user_id = ?');
    params.push(user.id);
  } else if (user.role === 'team_leader') {
    filters.push('u.department = ?');
    params.push(user.department);
  }
  if (typeof req.query.date === 'string' && req.query.date) {
    filters.push('mu.usage_date = ?');
    params.push(req.query.date);
  }
  const suffix = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`${usageSelect}${suffix} ORDER BY mu.usage_date DESC, mu.created_at DESC LIMIT 500`).all(...params) as Array<Record<string, unknown>>;
  success(res, rows.map(mapMaterialUsageRow));
});

materialUsageRouter.post('/', (req, res) => {
  const user = authUser(req);
  const materialKey = asText(req.body?.materialId || req.body?.materialName, '자재', 100);
  const quantity = asPositiveNumber(req.body?.quantity, '사용수량');
  const usageDate = asText(req.body?.workDate || req.body?.usageDate, '사용일자', 20);
  const purpose = asText(req.body?.purpose, '사용목적', 500);
  const material = db.prepare(`
    SELECT * FROM materials
     WHERE (id = ? OR material_name = ?) AND deleted_at IS NULL
  `).get(materialKey, materialKey) as Record<string, unknown> | undefined;
  if (!material) throw new ApiError(404, '자재 정보를 찾을 수 없습니다.', 'NOT_FOUND');

  const cellKey = optionalText(req.body?.cellId || req.body?.cellName, 100);
  const cell = cellKey
    ? db.prepare('SELECT id, cell_name FROM cells WHERE (id = ? OR cell_name = ?) AND deleted_at IS NULL').get(cellKey, cellKey) as { id: string; cell_name: string } | undefined
    : undefined;
  if (cellKey && !cell) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');

  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const stockUpdate = db.prepare(`
      UPDATE materials SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND stock_quantity >= ?
    `).run(quantity, String(material.id), quantity);
    if (stockUpdate.changes === 0) {
      throw new ApiError(409, '재고가 부족하여 자재사용을 저장할 수 없습니다.', 'INSUFFICIENT_STOCK');
    }
    db.prepare(`
      INSERT INTO material_usage (
        id, material_id, user_id, cell_id, work_id, quantity, usage_date, purpose,
        specification, unit, work_details, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(material.id),
      user.id,
      cell?.id || null,
      req.body?.workId || null,
      quantity,
      usageDate,
      purpose,
      req.body?.spec || String(material.specification || ''),
      req.body?.unit || String(material.unit),
      optionalText(req.body?.workDetails, 3000),
      optionalText(req.body?.remarks || req.body?.memo, 2000)
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const row = db.prepare(`${usageSelect} AND mu.id = ?`).get(id) as Record<string, unknown>;
  success(res, mapMaterialUsageRow(row), 201);
});

export default router;
