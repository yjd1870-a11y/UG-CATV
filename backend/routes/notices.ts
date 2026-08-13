import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { ApiError, asText, success } from '../http';
import { authUser, requireAuth, requireRoles } from '../security/session';

const router = Router();
router.use(requireAuth);

type NoticeRow = {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
};

const noticeRows = () => db.prepare(`
  SELECT n.id, n.title, n.content, n.sort_order AS sortOrder,
         n.created_at AS createdAt, n.updated_at AS updatedAt,
         creator.name AS createdByName, updater.name AS updatedByName
    FROM home_notices n
    LEFT JOIN users creator ON creator.id = n.created_by
    LEFT JOIN users updater ON updater.id = n.updated_by
   WHERE n.active = 1
   ORDER BY n.sort_order, n.created_at, n.id
`).all() as NoticeRow[];

router.get('/', (_req, res) => success(res, noticeRows()));

router.post('/', requireRoles('team_leader', 'admin'), (req, res) => {
  const user = authUser(req);
  const title = asText(req.body?.title, '제목', 120);
  const content = asText(req.body?.content, '내용', 2000);
  const maxOrder = Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM home_notices').get() as { value: number }).value);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO home_notices (id, title, content, sort_order, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, content, maxOrder + 1, user.id, user.id, new Date().toISOString(), new Date().toISOString());
  success(res, noticeRows().find((row) => row.id === id), 201);
});

router.put('/:id', requireRoles('team_leader', 'admin'), (req, res) => {
  const user = authUser(req);
  const existing = db.prepare('SELECT id, title, content, sort_order FROM home_notices WHERE id = ? AND active = 1').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, '전달사항을 찾을 수 없습니다.', 'NOT_FOUND');
  const title = req.body?.title === undefined ? String(existing.title) : asText(req.body.title, '제목', 120);
  const content = req.body?.content === undefined ? String(existing.content) : asText(req.body.content, '내용', 2000);
  const sortOrder = req.body?.sortOrder === undefined ? Number(existing.sort_order) : Number(req.body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new ApiError(400, '표시순서는 1 이상의 정수여야 합니다.', 'VALIDATION_ERROR');
  db.prepare(`
    UPDATE home_notices
       SET title = ?, content = ?, sort_order = ?, updated_by = ?, updated_at = ?
     WHERE id = ?
  `).run(title, content, sortOrder, user.id, new Date().toISOString(), req.params.id);
  success(res, noticeRows().find((row) => row.id === req.params.id));
});

router.delete('/:id', requireRoles('team_leader', 'admin'), (req, res) => {
  const result = db.prepare('DELETE FROM home_notices WHERE id = ?').run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '전달사항을 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, { id: req.params.id, deleted: true });
});

export default router;
