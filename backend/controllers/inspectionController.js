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
 */
const startInspection = async (req, res) => {
    try {


        const { serviceType, assumeRoleArn, inspectionConfig = {} } = req.body;
        const customerId = req.user.userId; // JWT 토큰에서 추출

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
            inspectionConfig
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
                totalJobs: result.data.inspectionJobs.length
            }));
        } else {
            // 기존 방식 (단일 검사) - 호환성 유지
            res.status(201).json(ApiResponse.success({
                message: 'Inspection started successfully',
                inspectionId: result.data.inspectionId,
                serviceType: serviceType,
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
 * 검사 이력 조회 (필터링 제거됨)
 * GET /api/inspections/history
 * Requirements: 3.2 - 고객이 검사 이력을 요청하여 날짜순으로 정렬된 검사 이력을 표시
 */
const getInspectionHistory = async (req, res) => {
    try {
        const customerId = req.user.userId;
        const { serviceType } = req.query;

        console.log(`🔍 [InspectionController] Simple inspection history request - Service: ${serviceType || 'ALL'}`);

        // 검사 이력 조회 (단일 테이블 구조)
        const result = await historyService.getInspectionHistory(customerId, {
            serviceType,
            aggregated: true
        });

        if (!result.success) {
            return res.status(500).json(ApiResponse.error({
                code: result.error?.code || 'HISTORY_RETRIEVAL_FAILED',
                message: result.error?.message || 'Failed to retrieve inspection history',
                details: result.error?.details || 'An error occurred while retrieving inspection history'
            }));
        }

        res.status(200).json(ApiResponse.success({
            message: 'Inspection history retrieved successfully',
            inspections: result.data.inspections,
            hasMore: result.data.hasMore,
            totalCount: result.data.count
        }));

    } catch (error) {
        console.error('Get inspection history error:', error);
        res.status(500).json(ApiResponse.error({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: 'An unexpected error occurred while retrieving inspection history'
        }));
    }
};



/**
 * 서비스별 검사 항목 상태 조회
 * GET /api/inspections/services/:serviceType/items
 */
const getServiceItemStatus = async (req, res) => {
    try {
        const { serviceType } = req.params;
        const customerId = req.user.userId;

        if (!serviceType) {
            return res.status(400).json(ApiResponse.error({
                code: 'MISSING_SERVICE_TYPE',
                message: 'Service type is required',
                details: 'Please specify the service type (EC2, RDS, S3, IAM)'
            }));
        }

        const result = await historyService.getInspectionHistory(customerId, {
            serviceType,
            historyMode: 'latest'
        });

        if (!result.success) {
            return res.status(500).json(ApiResponse.error({
                code: 'ITEM_STATUS_RETRIEVAL_FAILED',
                message: 'Failed to retrieve item status',
                details: result.error
            }));
        }

        res.status(200).json(ApiResponse.success({
            message: 'Service item status retrieved successfully',
            serviceType,
            items: result.data.services[serviceType] || {}
        }));

    } catch (error) {
        console.error('Get service item status error:', error);
        res.status(500).json(ApiResponse.error({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            details: 'An unexpected error occurred while retrieving service item status'
        }));
    }
};



/**
 * 검사 항목 상태 조회 (서비스별 필터링 지원)
 * GET /api/inspections/items/status?serviceType=EC2
 */
const getAllItemStatus = async (req, res) => {
    try {
        const customerId = req.user.userId;
        const { serviceType } = req.query;
        
        console.log(`🔍 [InspectionController] Getting item status for customer ${customerId}, service: ${serviceType || 'ALL'}`);

        // 단일 테이블 구조에서 최신 검사 결과 조회
        const result = await historyService.getInspectionHistory(customerId, {
            historyMode: 'latest',
            serviceType: serviceType  // 서비스 타입 필터 추가
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
 */
const getItemInspectionHistory = async (req, res) => {
    try {
        const customerId = req.user.userId;
        const {
            serviceType,
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
    getInspectionHistory,
    getServiceItemStatus,
    getAllItemStatus,
    getItemInspectionHistory
};