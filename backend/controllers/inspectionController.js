const historyService = require('../services/historyService');
const inspectionService = require('../services/inspectionService');
const { ApiResponse } = require('../models/ApiResponse');

/**
 * Inspection Controller
 * AWS 리소스 검사 관련 API 엔드포인트 구현
 * Requirements: 1.1, 1.2, 3.2, 6.3
 */

/**
 * 검사 시작
 * POST /api/inspections/start
 * Requirements: 1.1 - 승인된 고객이 AWS 서비스 검사를 요청
 * 
 * 역할: AWS 리소스 검사를 시작하는 핵심 엔드포인트
 * - 요청 데이터 검증 (serviceType, assumeRoleArn)
 * - inspectionService를 통한 검사 실행
 * - 배치 방식과 단일 검사 방식 모두 지원
 * - WebSocket 구독 정보와 함께 응답 반환
 * 
 * 사용처: ServiceInspectionSelector에서 검사 시작 버튼 클릭 시
 */
const startInspection = async (req, res) => {
    try {


        const { serviceType, assumeRoleArn, region, inspectionConfig = {} } = req.body;
        const customerId = req.user.userId; // JWT 토큰에서 추출
        
        // 리전 정보를 inspectionConfig에 추가
        const finalInspectionConfig = {
            ...inspectionConfig,
            region: region || inspectionConfig.region || 'us-east-1'
        };

        // 입력 검증
        if (!serviceType) {
            return res.status(400).json(ApiResponse.error({
                code: 'MISSING_SERVICE_TYPE',
                message: 'Service type is required',
                details: 'Please specify which AWS service to inspect (e.g., EC2, RDS, S3)'
            }));
        }

        if (!assumeRoleArn) {
            return res.status(400).json(ApiResponse.error({
                code: 'MISSING_ROLE_ARN',
                message: 'Assume role ARN is required',
                details: 'Please provide the ARN of the role to assume in your AWS account'
            }));
        }

        // 검사 시작
        const result = await inspectionService.startInspection(
            customerId,
            serviceType,
            assumeRoleArn,
            finalInspectionConfig
        );

        if (!result.success) {
            return res.status(500).json(ApiResponse.error({
                code: result.error?.code || 'INSPECTION_START_FAILED',
                message: result.error?.message || 'Failed to start inspection',
                details: result.error?.details || 'An error occurred while starting the inspection'
            }));
        }

        // 새로운 배치 방식 응답 처리
        if (result.data.batchId) {
            // 배치 방식 (여러 개별 검사)
            res.status(201).json(ApiResponse.success({
                message: result.data.message,
                batchId: result.data.batchId,
                inspectionJobs: result.data.inspectionJobs,
                serviceType: serviceType,
                region: finalInspectionConfig.region,
                totalJobs: result.data.inspectionJobs.length
            }));
        } else {
            // 기존 방식 (단일 검사) - 호환성 유지
            res.status(201).json(ApiResponse.success({
                message: 'Inspection started successfully',
                inspectionId: result.data.inspectionId,
                serviceType: serviceType,
                region: finalInspectionConfig.region,
                status: result.data.status,
                estimatedDuration: result.estimatedDuration
            }));
        }

    } catch (error) {
        console.error('Start inspection error:', error);
        res.status(500).json(ApiResponse.error({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: 'An unexpected error occurred while starting the inspection'
        }));
    }
};









/**
 * 검사 항목 상태 조회 (서비스별 필터링 지원)
 * GET /api/inspections/items/status?serviceType=EC2
 * 
 * 역할: 모든 서비스 또는 특정 서비스의 검사 항목 상태를 조회
 * - 쿼리 파라미터로 서비스 필터링 (선택사항)
 * - 캐시 무효화 헤더 설정 (실시간 데이터)
 * - Trusted Advisor 스타일 대시보드용
 * - 각 검사 항목의 최신 상태와 findings 정보 제공
 * 
 * 사용처: ServiceInspectionSelector에서 서비스 선택 시 검사 항목 상태 표시
 */
const getAllItemStatus = async (req, res) => {
    try {
        const customerId = req.user.userId;
        const { serviceType, region } = req.query;

        console.log(`🔍 [InspectionController] Getting item status for customer ${customerId}, service: ${serviceType || 'ALL'}, region: ${region || 'ALL'}`);

        // 단일 테이블 구조에서 최신 검사 결과 조회
        const result = await historyService.getInspectionHistory(customerId, {
            historyMode: 'latest',
            serviceType: serviceType,  // 서비스 타입 필터 추가
            region: region  // 리전 필터 추가
        });

        console.log(`🔍 [InspectionController] History service result:`, {
            success: result.success,
            hasData: !!result.data,
            serviceCount: Object.keys(result.data?.services || {}).length
        });


        if (!result.success) {
            console.error(`❌ [InspectionController] Failed to get item status for ${customerId}`);
            return res.status(500).json(ApiResponse.error({
                code: 'ALL_ITEM_STATUS_RETRIEVAL_FAILED',
                message: 'Failed to retrieve all item status',
                details: result.error
            }));
        }

        console.log(`✅ [InspectionController] Returning item status for ${customerId}`, {
            serviceTypes: Object.keys(result.data.services),
            totalItems: Object.values(result.data.services).reduce((sum, service) => sum + Object.keys(service).length, 0)
        });

        // 캐시 무효화 헤더 추가
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        res.status(200).json(ApiResponse.success(result.data));

    } catch (error) {
        console.error(`❌ [InspectionController] Get all item status error for customer:`, error);
        res.status(500).json(ApiResponse.error({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: 'An unexpected error occurred while retrieving all item status'
        }));
    }
};

/**
 * 항목별 검사 이력 조회 (페이지네이션 지원)
 * GET /api/inspections/items/history
 * 
 * 역할: 검사 항목별 상세 이력을 페이지네이션으로 조회
 * - 페이지네이션 지원 (lastEvaluatedKey)
 * - historyMode 설정 가능 ('history' 또는 'latest')
 * - 대용량 데이터 처리 최적화
 * - 시간순 정렬된 상세 검사 기록 제공
 * 
 * 사용처: 상세 이력 화면, 트렌드 분석, 검사 항목별 변화 추적
 */
const getItemInspectionHistory = async (req, res) => {
    try {
        const customerId = req.user.userId;
        const {
            serviceType,
            region,
            historyMode = 'history',
            lastEvaluatedKey
        } = req.query;

        console.log(`🔍 [InspectionController] Paginated history request:`, {
            service: serviceType || 'ALL',
            hasLastKey: !!lastEvaluatedKey
        });

        // 항목별 검사 이력 조회 (페이지네이션 지원)
        const result = await historyService.getInspectionHistory(customerId, {
            serviceType,
            region,
            historyMode,
            lastEvaluatedKey
        });

        if (!result.success) {
            return res.status(500).json(ApiResponse.error({
                code: result.error?.code || 'ITEM_HISTORY_RETRIEVAL_FAILED',
                message: result.error?.message || 'Failed to retrieve item inspection history',
                details: result.error?.details || 'An error occurred while retrieving item inspection history'
            }));
        }

        res.status(200).json(ApiResponse.success({
            message: 'Item inspection history retrieved successfully',
            items: result.data.items || [],
            count: result.data.count || 0,
            hasMore: result.data.hasMore || false,
            lastEvaluatedKey: result.data.lastEvaluatedKey || null
        }));

    } catch (error) {
        console.error('Get item inspection history error:', error);
        res.status(500).json(ApiResponse.error({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: 'An unexpected error occurred while retrieving item inspection history'
        }));
    }
};

module.exports = {
    startInspection,
    getAllItemStatus,
    getItemInspectionHistory
};