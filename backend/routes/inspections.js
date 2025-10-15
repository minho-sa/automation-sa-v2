const express = require('express');
const { authenticateToken, requireApprovedUser } = require('../middleware/auth');
const { validateInspectionStart } = require('../middleware/validation');
const { inspectionLimiter } = require('../middleware/rateLimiter');
const inspectionController = require('../controllers/inspectionController');

const router = express.Router();

// 검사 관련 API에 별도의 Rate Limiting 적용
router.use(inspectionLimiter);

// 모든 inspection 라우트는 인증과 승인된 사용자 상태가 필요
// Requirements: 1.1 - 승인된 고객만 AWS 서비스 검사를 요청할 수 있음
router.use(authenticateToken);
router.use(requireApprovedUser);



/**
 * POST /api/inspections/start
 * 검사 시작
 * Requirements: 1.1 - 승인된 고객이 AWS 서비스 검사를 요청
 */
router.post('/start', validateInspectionStart, inspectionController.startInspection);



/**
 * GET /api/inspections/items/history
 * 검사 항목별 히스토리 조회
 * 각 검사 항목별로 개별 기록을 시간순으로 표시
 */
router.get('/items/history', inspectionController.getItemInspectionHistory);

/**
 * GET /api/inspections/items/status
 * 모든 서비스의 검사 항목 상태 조회
 * Trusted Advisor 스타일 - 각 검사 항목별 최근 상태
 */
router.get('/items/status', inspectionController.getAllItemStatus);







// dataConsistency 관련 라우트 제거 - 단순화

module.exports = router;