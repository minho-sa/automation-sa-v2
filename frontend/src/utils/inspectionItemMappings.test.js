/**
 * 검사 항목 매핑 유틸리티 테스트
 */

import { 
  getItemName, 
  getItemInfo, 
  getItemDescription, 
  getItemSeverity,
  getItemCategory,
  normalizeItemId,
  denormalizeItemId,
  getAllItems,
  findServiceTypeByItemId
} from './inspectionItemMappings';

// 테스트용 콘솔 출력 함수
export function testInspectionItemMappings() {
  console.log('=== 검사 항목 매핑 테스트 ===');
  
  // 1. 기본 매핑 테스트
  console.log('\n1. 기본 매핑 테스트:');
  console.log('EC2 dangerous_ports:', getItemName('EC2', 'dangerous_ports'));
  console.log('EC2 dangerous-ports:', getItemName('EC2', 'dangerous-ports'));
  console.log('S3 bucket-encryption:', getItemName('S3', 'bucket-encryption'));
  console.log('IAM root-access-key:', getItemName('IAM', 'root-access-key'));
  
  // 2. 상세 정보 테스트
  console.log('\n2. 상세 정보 테스트:');
  const itemInfo = getItemInfo('EC2', 'dangerous_ports');
  console.log('EC2 dangerous_ports 정보:', itemInfo);
  
  // 3. 개별 속성 테스트
  console.log('\n3. 개별 속성 테스트:');
  console.log('설명:', getItemDescription('EC2', 'dangerous_ports'));
  console.log('심각도:', getItemSeverity('EC2', 'dangerous_ports'));
  console.log('카테고리:', getItemCategory('EC2', 'dangerous_ports'));
  
  // 4. ID 정규화 테스트
  console.log('\n4. ID 정규화 테스트:');
  console.log('dangerous_ports → dangerous-ports:', normalizeItemId('dangerous_ports'));
  console.log('dangerous-ports → dangerous_ports:', denormalizeItemId('dangerous-ports'));
  
  // 5. 전체 항목 조회 테스트
  console.log('\n5. 전체 항목 조회 테스트:');
  const ec2Items = getAllItems('EC2');
  console.log('EC2 전체 항목 수:', ec2Items.length);
  console.log('EC2 첫 번째 항목:', ec2Items[0]?.name);
  
  // 6. 서비스 타입 찾기 테스트
  console.log('\n6. 서비스 타입 찾기 테스트:');
  console.log('dangerous_ports 서비스:', findServiceTypeByItemId('dangerous_ports'));
  console.log('bucket-encryption 서비스:', findServiceTypeByItemId('bucket-encryption'));
  
  console.log('\n=== 테스트 완료 ===');
}

// 브라우저 콘솔에서 테스트 실행 가능하도록 전역 함수로 등록
if (typeof window !== 'undefined') {
  window.testInspectionItemMappings = testInspectionItemMappings;
}