/**
 * 검사 항목 매핑 유틸리티
 */

import { inspectionItems } from '../data/inspectionItems';

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

// 검사 항목 심각도 가져오기
export const getItemSeverity = (serviceType, itemId) => {
    const itemInfo = getItemInfo(serviceType, itemId);
    return itemInfo?.severity || 'MEDIUM';
};

// 심각도별 색상 가져오기
export const getSeverityColor = (severity) => {
    const colors = {
        'CRITICAL': '#dc2626',
        'HIGH': '#ea580c',
        'MEDIUM': '#d97706',
        'LOW': '#65a30d'
    };
    return colors[severity] || '#6b7280';
};

// 심각도별 아이콘 가져오기 (아이콘 없이 깔끔하게)
export const getSeverityIcon = (severity) => {
    // 아이콘 없이 색상과 텍스트만으로 구분
    return '';
};

// 테스트용 함수
export const testFunction = () => {
    console.log('Test function works!');
    return 'test';
};