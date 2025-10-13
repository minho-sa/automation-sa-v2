/**
 * 검사 항목 매핑 유틸리티 (프론트엔드 전용)
 * DB에는 itemId만 저장하고, 프론트엔드에서만 이름을 매핑하여 표시
 */

import { inspectionItems } from '../data/inspectionItems';

/**
 * 검사 항목명 가져오기
 * @param {string} serviceType - 서비스 타입
 * @param {string} itemId - 항목 ID
 * @returns {string} 항목명
 */
export function getItemName(serviceType, itemId) {
  // 정규화된 itemId로 변환 (언더스코어 -> 하이픈)
  const normalizedItemId = normalizeItemId(itemId);
  
  // inspectionItems에서 찾기
  const service = inspectionItems[serviceType];
  if (service) {
    for (const category of service.categories) {
      const item = category.items.find(item => item.id === normalizedItemId);
      if (item) {
        return item.name;
      }
    }
  }
  
  // 레거시 매핑 (기존 데이터 호환성)
  const legacyMappings = {
    EC2: {
      'security_groups': '보안 그룹 규칙',
      'instance_metadata': '인스턴스 메타데이터',
      'public_access': '퍼블릭 접근 검사',
      'iam_roles': 'IAM 역할 및 권한',
      'network_acls': '네트워크 ACL',
      'monitoring_logging': '모니터링 및 로깅',
      'backup_recovery': '백업 및 복구',
      'network_access': '네트워크 접근 제어'
    },
    S3: {
      'bucket_policy': '버킷 정책',
      'public_access': '퍼블릭 접근 차단',
      'encryption': '서버 측 암호화',
      'versioning': '버전 관리',
      'bucket_encryption': '버킷 암호화',
      'bucket_public_access': '버킷 퍼블릭 접근'
    },
    IAM: {
      'overprivileged_user_policies': '과도한 권한 사용자 정책',
      'overprivileged_role_policies': '과도한 권한 역할 정책',
      'unused_policies': '사용하지 않는 정책',
      'root_access_key': '루트 계정 액세스 키',
      'mfa_enabled': 'MFA 활성화',
      'unused_credentials': '미사용 자격 증명'
    }
  };
  
  return legacyMappings[serviceType]?.[itemId] || itemId;
}

/**
 * 검사 항목 정보 가져오기 (프론트엔드 전용)
 * @param {string} serviceType - 서비스 타입
 * @param {string} itemId - 항목 ID
 * @returns {Object|null} 항목 정보
 */
export function getItemInfo(serviceType, itemId) {
  const service = inspectionItems[serviceType];
  if (service) {
    for (const category of service.categories) {
      const item = category.items.find(item => item.id === itemId);
      if (item) {
        return item;
      }
    }
  }
  return null;
}

/**
 * 검사 항목 ID 정규화 (하이픈/언더스코어 통일)
 * @param {string} itemId - 항목 ID
 * @returns {string} 정규화된 항목 ID
 */
export function normalizeItemId(itemId) {
  // 백엔드에서 오는 언더스코어를 하이픈으로 변환
  return itemId.replace(/_/g, '-');
}

/**
 * 역방향 정규화 (프론트엔드 -> 백엔드)
 * @param {string} itemId - 항목 ID
 * @returns {string} 백엔드용 항목 ID
 */
export function denormalizeItemId(itemId) {
  // 프론트엔드의 하이픈을 백엔드용 언더스코어로 변환
  return itemId.replace(/-/g, '_');
}