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
        description: 'EC2 보안 설정 및 접근 제어 검사',
        items: [
          {
            id: 'dangerous_ports',
            name: '보안 그룹 - 위험한 포트 노출',
            shortDescription: 'SSH, RDP 등 위험한 포트의 인터넷 노출 검사',
            description: 'SSH(22), RDP(3389), 데이터베이스 포트(3306, 5432, 1433) 등이 인터넷(0.0.0.0/0)에 개방되어 있는지 검사합니다. 이러한 포트가 공개되면 무차별 대입 공격의 위험이 높아집니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'ebs-encryption',
            name: 'EBS 볼륨 암호화 상태',
            shortDescription: '암호화되지 않은 EBS 볼륨과 스냅샷 검사',
            description: '암호화되지 않은 EBS 볼륨과 스냅샷을 식별합니다. 데이터 보호 규정 준수와 민감한 정보 보안을 위해 모든 EBS 볼륨은 암호화되어야 합니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'ebs-volume-version',
            name: 'EBS 볼륨 버전',
            shortDescription: '구형 볼륨 타입 및 GP3 업그레이드 검사',
            description: '2년 이상 된 인스턴스의 구형 볼륨 타입 및 GP3 업그레이드를 검사합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'termination-protection',
            name: '종료 보호 설정',
            shortDescription: '중요 인스턴스의 실수 삭제 방지 설정 검사',
            description: '중요한 인스턴스의 실수 삭제 방지를 위한 종료 보호 설정을 검사합니다',
            severity: 'WARN',
            enabled: true
          }
        ]
      },
      {
        id: 'cost-optimization',
        name: '비용 최적화',
        description: '미사용 리소스 및 비용 절감 기회 검사',
        items: [
          {
            id: 'unused-security-groups',
            name: '미사용 보안 그룹',
            shortDescription: '인스턴스에 연결되지 않은 보안 그룹 검사',
            description: 'EC2 인스턴스에 연결되지 않은 보안 그룹을 검사합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'unused-elastic-ip',
            name: '미사용 Elastic IP',
            shortDescription: '중지된 인스턴스의 Elastic IP 검사',
            description: '중지된 인스턴스에 연결된 Elastic IP를 검사합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'old-snapshots',
            name: '오래된 스냅샷',
            shortDescription: '90일 이상 된 스냅샷 정리 권장',
            description: '종료된 인스턴스 및 90일 이상 된 스냅샷 정리를 권장합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'stopped-instances',
            name: '중지된 인스턴스',
            shortDescription: '30일 이상 중지된 인스턴스 검사',
            description: '30일 이상 중지된 인스턴스의 비용 절감 기회를 검사합니다',
            severity: 'WARN',
            enabled: true
          }
        ]
      }
    ]
  },

  RDS: {
    id: 'RDS',
    name: 'Amazon RDS',
    description: 'RDS 데이터베이스의 보안 설정, 백업 정책, 성능 최적화 상태를 검사하여 데이터 보호와 고가용성을 보장합니다',
    icon: '🗄️',
    color: '#3F48CC',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'RDS 보안 설정 및 암호화 검사',
        items: [
          {
            id: 'encryption',
            name: '암호화 설정',
            shortDescription: '저장 시 및 전송 중 암호화 설정 검사',
            description: '저장 시 암호화 및 전송 중 암호화 설정을 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'security-groups',
            name: '데이터베이스 보안 그룹',
            shortDescription: '데이터베이스 접근 권한 및 네트워크 보안 검사',
            description: '데이터베이스 접근 권한 및 네트워크 보안을 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'public-access',
            name: '퍼블릭 접근 설정',
            shortDescription: '불필요한 퍼블릭 접근 허용 여부 검사',
            description: '불필요한 퍼블릭 접근 허용 여부를 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          }
        ]
      },
      {
        id: 'backup',
        name: '백업 및 복구',
        description: 'RDS 백업 정책 및 복구 설정 검사',
        items: [
          {
            id: 'automated-backup',
            name: '자동 백업',
            shortDescription: '자동 백업 활성화 및 보존 기간 검사',
            description: '자동 백업 활성화 및 보존 기간을 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'snapshot-encryption',
            name: '스냅샷 암호화',
            shortDescription: '데이터베이스 스냅샷 암호화 설정 검사',
            description: '데이터베이스 스냅샷 암호화 설정을 검사합니다',
            severity: 'WARN',
            enabled: false
          }
        ]
      }
    ]
  },

  IAM: {
    id: 'IAM',
    name: 'AWS IAM',
    description: 'IAM 사용자, 역할, 정책의 보안 설정을 검사하여 최소 권한 원칙 준수와 계정 보안을 강화합니다',
    icon: '👤',
    color: '#FF4B4B',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'IAM 보안 설정 및 접근 제어 검사',
        items: [
          {
            id: 'root-access-key',
            name: '루트 계정 액세스 키 사용',
            shortDescription: '루트 계정의 액세스 키 존재 여부 검사',
            description: '루트 계정에 생성된 액세스 키가 있는지 검사합니다. 루트 계정은 모든 권한을 가지므로 액세스 키 사용은 극도로 위험하며 AWS 보안 모범 사례에 위배됩니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'mfa-enabled',
            name: '다중 인증(MFA) 활성화',
            shortDescription: 'IAM 사용자 및 루트 계정의 MFA 설정 검사',
            description: 'IAM 사용자와 루트 계정의 MFA 활성화 상태를 검사합니다. MFA는 계정 탈취 위험을 크게 줄이는 필수 보안 조치입니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'unused-credentials',
            name: '장기 미사용 자격 증명',
            shortDescription: '90일 이상 미사용 액세스 키 검사',
            description: '90일 이상 사용되지 않은 액세스 키와 콘솔 로그인을 검사합니다. 미사용 자격 증명은 보안 위험을 증가시키므로 정기적으로 정리해야 합니다.',
            severity: 'WARN',
            enabled: true
          }
        ]
      },
      {
        id: 'policies',
        name: '정책 관리',
        description: 'IAM 정책 및 권한 검사',
        items: [
          {
            id: 'overprivileged-user-policies',
            name: '사용자 과도한 권한',
            shortDescription: '필요 이상의 권한을 가진 사용자 정책 검사',
            description: '필요 이상의 권한을 가진 사용자 정책을 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'overprivileged-role-policies',
            name: '역할 과도한 권한',
            shortDescription: '필요 이상의 권한을 가진 역할 정책 검사',
            description: '필요 이상의 권한을 가진 역할 정책을 검사합니다',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'inline-policies',
            name: '인라인 정책',
            shortDescription: '관리되지 않는 인라인 정책 사용 검사',
            description: '관리되지 않는 인라인 정책 사용을 검사합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'unused-policies',
            name: '사용되지 않는 정책',
            shortDescription: '연결되지 않은 정책 검사',
            description: '어떤 사용자나 역할에도 연결되지 않은 정책을 검사합니다',
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
    description: 'S3 버킷의 보안 설정, 암호화 상태, 접근 제어 정책을 검사하여 데이터 유출 방지와 규정 준수를 보장합니다',
    icon: '🪣',
    color: '#569A31',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'S3 보안 설정 및 접근 제어 검사',
        items: [
          {
            id: 'bucket-encryption',
            name: 'S3 버킷 서버 측 암호화',
            shortDescription: '버킷의 기본 암호화 설정 검사',
            description: '버킷의 기본 암호화 설정과 KMS 키 사용 여부를 검사합니다. 저장된 데이터의 보안을 위해 모든 S3 버킷은 암호화되어야 합니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'bucket-public-access',
            name: 'S3 버킷 퍼블릭 액세스 차단',
            shortDescription: '버킷의 퍼블릭 액세스 차단 설정 검사',
            description: '버킷의 퍼블릭 액세스 차단 설정을 검사합니다. 의도하지 않은 데이터 노출을 방지하기 위해 퍼블릭 액세스는 차단되어야 합니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'bucket-policy',
            name: 'S3 버킷 정책 보안',
            shortDescription: '과도한 권한의 버킷 정책 검사',
            description: '과도하게 관대한 버킷 정책이나 와일드카드(*) 사용으로 인한 보안 위험을 검사합니다. 최소 권한 원칙에 따라 정책을 설정해야 합니다.',
            severity: 'CRITICAL',
            enabled: true
          },
          {
            id: 'bucket-cors',
            name: 'CORS 설정',
            shortDescription: '위험한 CORS 설정 및 와일드카드 검사',
            description: '위험한 CORS 설정 및 와일드카드 사용을 검사합니다',
            severity: 'WARN',
            enabled: true
          }
        ]
      },
      {
        id: 'data-protection',
        name: '데이터 보호',
        description: 'S3 데이터 보호 및 백업 설정 검사',
        items: [
          {
            id: 'bucket-versioning',
            name: '버전 관리',
            shortDescription: '버킷의 버전 관리 활성화 여부 검사',
            description: '버킷의 버전 관리 활성화 여부를 검사합니다',
            severity: 'WARN',
            enabled: true
          },
          {
            id: 'bucket-logging',
            name: '액세스 로깅',
            shortDescription: '버킷의 액세스 로깅 활성화 여부 검사',
            description: '버킷의 액세스 로깅 활성화 여부를 검사합니다',
            severity: 'WARN',
            enabled: true
          }
        ]
      },
      {
        id: 'cost-optimization',
        name: '비용 최적화',
        description: 'S3 스토리지 비용 최적화 검사',
        items: [
          {
            id: 'bucket-lifecycle',
            name: '라이프사이클 정책',
            shortDescription: '스토리지 클래스 전환 및 객체 만료 정책 검사',
            description: '스토리지 클래스 전환 및 객체 만료 정책을 검사합니다',
            severity: 'WARN',
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