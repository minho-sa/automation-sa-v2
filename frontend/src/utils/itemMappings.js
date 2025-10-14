/**
 * 검사 항목 매핑 유틸리티 - CRITICAL/WARN 두 가지 severity 시스템
 */

import { inspectionItems, InspectionResultModel, severityColors, severityIcons } from '../data/inspectionItems';

// 검사 항목 정보 가져오기
export const getItemInfo = (serviceType, itemId) => {
    const service = inspectionItems[serviceType];
    if (service) {
        for (const category of service.categories) {
            const item = category.items.find(item => item.id === itemId);
            if (item) {
                return {
                    ...item,
                    categoryName: category.name,
                    categoryId: category.id
                };
            }
        }
    }
    return null;
};

// 검사 항목명 가져오기
export const getItemName = (serviceType, itemId) => {
    const itemInfo = getItemInfo(serviceType, itemId);
    return itemInfo?.name || itemId;
};

// 검사 항목의 기본 severity 가져오기 (CRITICAL 또는 WARN)
export const getItemSeverity = (serviceType, itemId) => {
    return InspectionResultModel.getBaseSeverity(serviceType, itemId);
};

// 심각도별 색상 가져오기 (CRITICAL, WARN, PASS)
export const getSeverityColor = (severity) => {
    return severityColors[severity] || '#6b7280';
};

// 심각도별 아이콘 가져오기
export const getSeverityIcon = (severity) => {
    return severityIcons[severity] || 'ℹ️';
};

// 검사 결과 상태 결정 (findings 기반)
export const determineInspectionStatus = (item, baseSeverity) => {
    return InspectionResultModel.determineStatus(item, baseSeverity);
};

// 검사 결과를 UI용으로 변환
export const transformInspectionResults = (results) => {
    return InspectionResultModel.transformForUI(results);
};

// 검사 항목의 실제 상태 가져오기 (findings 배열 기반)
export const getActualStatus = (item) => {
    const baseSeverity = getItemSeverity(item.serviceType, item.itemId);
    return determineInspectionStatus(item, baseSeverity);
};

// 상태별 통계 계산
export const calculateStatusStats = (inspectionResults) => {
    const stats = {
        CRITICAL: 0,
        WARN: 0,
        PASS: 0,
        total: inspectionResults.length
    };

    inspectionResults.forEach(item => {
        const status = getActualStatus(item);
        stats[status]++;
    });

    return stats;
};

// 검사 결과 요약 생성 (백엔드에서 제거된 기능을 프론트엔드에서 처리)
export const generateItemSummary = (findings) => {
    return {
        totalFindings: findings.length,
        resourcesAffected: [...new Set(findings.map(f => f.resourceId))].length,
        issuesFound: findings.length
    };
};

// 테스트용 함수
export const testFunction = () => {
    console.log('Simplified data model loaded!');
    return 'test';
};