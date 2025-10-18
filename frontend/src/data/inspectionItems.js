// AWS 보안 검사 항목 정의 - CRITICAL/WARN 두 가지 severity 시스템
export const inspectionItems = {
  EC2: {
    id: 'EC2',
    name: 'Amazon EC2',
    description: 'EC2 인스턴스의 보안 설정, 성능 최적화, 비용 효율성을 종합적으로 검사하여 AWS 모범 사례를 준수하는지 확인합니다',
    icon: '🖥️',
    color: '#FF9900',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'EC2 보안 설정, 접근 제어 및 네트워크 구성 검사',
        items: [
          {
            id: 'security-groups',
            name: '보안 그룹 - 위험한 포트 노출',
            shortDescription: '보안그룹의 인바운드 규칙에서 SSH(22), RDP(3389), Telnet(23), FTP(21), MySQL(3306), PostgreSQL(5432) 포트가 인터넷(0.0.0.0/0)에 개방되어 있는지 검사. 단일 포트뿐만 아니라 포트 범위 내 위험한 포트 포함 여부도 탐지',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'backup-status',
            name: '인스턴스 백업 상태 검사',
            shortDescription: '실행 중인 EC2 인스턴스에 연결된 EBS 볼륨의 최근 7일 내 스냅샷 존재 여부 검사. EBS 볼륨이 연결되지 않은 인스턴스도 별도 보고',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'windows-server-eol',
            name: 'Windows Server 지원 종료',
            shortDescription: 'Windows 플랫폼 EC2 인스턴스의 AMI 이름과 설명을 분석하여 Windows Server 버전을 식별하고 지원 종료 상태 검사. 이미 종료된 버전과 6개월 내 종료 예정 버전 탐지',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'public-instances',
            name: 'EC2 퍼블릭 인스턴스 검사',
            shortDescription: '실행 중인 EC2 인스턴스의 퍼블릭 IP 직접 할당 상태와 서브넷의 퍼블릭 IP 자동 할당 설정을 종합 검사하여 불필요한 퍼블릭 노출 식별',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'stopped-instances',
            name: '중지된 EC2 인스턴스 검사',
            shortDescription: '중지된 상태의 EC2 인스턴스를 검사합니다. 중지된 인스턴스는 EBS 볼륨에 대한 비용이 지속적으로 발생하므로 장기간 사용하지 않는 인스턴스는 종료를 고려해야 합니다',
            severity: 'WARN',
            enabled: true
          }
        ]
      },
      {
        id: 'optimization',
        name: '최적화',
        description: 'EC2 인스턴스의 성능 및 비용 최적화 검사',
        items: [
          {
            id: 'instance-type-optimization',
            name: '인스턴스 타입 최적화',
            shortDescription: '실행 중인 EC2 인스턴스의 최근 7일간 CloudWatch CPU 사용률 분석. 평균 10% 미만은 다운사이징, 80% 이상은 업그레이드 권장하여 비용과 성능 최적화',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'reserved-instances',
            name: '예약 인스턴스 현황 및 만료 검사',
            shortDescription: '예약 인스턴스(RI)의 만료 일정과 사용률을 검사. 30일 이내 만료 예정인 RI를 식별하고, 사용률이 낮거나 초과 사용되는 RI를 찾아 비용 최적화 방안 제시',
            severity: 'WARN',
            enabled: true
          }
        ]
      }
    ]
  },
  S3: {
    id: 'S3',
    name: 'Amazon S3',
    description: 'S3 버킷의 보안 설정, 접근 제어 및 데이터 보호 구성을 종합적으로 검사하여 AWS 모범 사례를 준수하는지 확인합니다',
    icon: '🪣',
    color: '#569A31',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'S3 버킷 보안 설정 및 접근 제어 검사',
        items: [
          {
            id: 'public-access',
            name: 'S3 버킷 퍼블릭 액세스 설정',
            shortDescription: 'S3 버킷의 퍼블릭 액세스 차단 설정을 검사하여 보안 위험을 식별. BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets 4가지 설정이 모두 활성화되어 있는지 확인',
            severity: 'CRITICAL',
            enabled: true
          }
        ]
      }
    ]
  }
};

// 심각도별 색상 정의 - CRITICAL/WARN/PASS 3단계 시스템
export const severityColors = {
  CRITICAL: '#DC2626',  // 빨간색 - 심각한 보안 문제
  WARN: '#F59E0B',      // 노란색 - 경고 수준 문제
  PASS: '#10B981'       // 초록색 - 문제 없음
};

// 심각도별 아이콘
export const severityIcons = {
  CRITICAL: '🚨',
  WARN: '⚠️',
  PASS: '✅'
};

// 검사 결과 상태 결정 모델
export class InspectionResultModel {
  /**
   * findings 배열을 기반으로 검사 항목의 실제 상태를 결정
   * @param {Object} item - 검사 항목 데이터
   * @param {string} baseSeverity - 기본 severity (CRITICAL 또는 WARN)
   * @returns {string} 실제 상태 (CRITICAL, WARN, PASS)
   */
  static determineStatus(item, baseSeverity) {
    const findings = item.findings || [];
    
    // findings가 없으면 PASS
    if (findings.length === 0) {
      return 'PASS';
    }
    
    // findings가 있으면 기본 severity 상속
    return baseSeverity;
  }

  /**
   * 검사 항목의 기본 severity 가져오기
   * @param {string} serviceType - 서비스 타입 (EC2, RDS, IAM, S3)
   * @param {string} itemId - 검사 항목 ID
   * @returns {string} 기본 severity (CRITICAL 또는 WARN)
   */
  static getBaseSeverity(serviceType, itemId) {
    const service = inspectionItems[serviceType];
    if (!service) return 'WARN';

    for (const category of service.categories) {
      const item = category.items.find(item => item.id === itemId);
      if (item) {
        return item.severity;
      }
    }
    
    return 'WARN'; // 기본값
  }

  /**
   * 검사 결과 데이터를 UI 표시용으로 변환
   * @param {Array} inspectionResults - 검사 결과 배열
   * @returns {Array} UI 표시용 데이터
   */
  static transformForUI(inspectionResults) {
    return inspectionResults.map(item => {
      const baseSeverity = this.getBaseSeverity(item.serviceType, item.itemId);
      const actualStatus = this.determineStatus(item, baseSeverity);
      
      return {
        ...item,
        baseSeverity,      // 기본 severity
        actualStatus,      // 실제 상태 (findings 기반)
        color: severityColors[actualStatus],
        icon: severityIcons[actualStatus],
        findingsCount: (item.findings || []).length
      };
    });
  }
}