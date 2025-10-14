# 🔍 검사 항목 설정 가이드

## 📋 목차
1. [검사 항목 개요](#검사-항목-개요)
2. [Severity 시스템](#severity-시스템)
3. [검사 항목 구조](#검사-항목-구조)
4. [서비스별 검사 항목](#서비스별-검사-항목)
5. [새로운 검사 항목 추가](#새로운-검사-항목-추가)

---

## 🎯 검사 항목 개요

AWS 보안 검사는 **서비스별 → 카테고리별 → 검사 항목별**로 구성된 계층 구조를 가집니다.

### 📊 **구조 개요**
```
AWS 서비스 (EC2, RDS, IAM, S3)
├── 카테고리 (보안, 비용 최적화, 성능)
    └── 검사 항목 (위험한 포트, 암호화 등)
```

### 🎨 **Severity 기반 상태 결정**
- **프론트엔드**: 검사 항목의 severity 정의 (CRITICAL/WARN)
- **백엔드**: findings 배열만 반환
- **상태 결정**: findings 유무 + severity → 최종 상태 (CRITICAL/WARN/PASS)

---

## 🚨 Severity 시스템

### 📊 **3단계 Severity**
| Severity | 색상 | 의미 | 예시 |
|----------|------|------|------|
| **CRITICAL** | 🔴 빨간색 | 심각한 보안 문제 | 위험한 포트 노출, 암호화 미설정 |
| **WARN** | 🟡 노란색 | 경고 수준 문제 | 구형 볼륨 타입, 미사용 리소스 |
| **PASS** | 🟢 초록색 | 문제 없음 | findings가 없는 경우 |

### 🔄 **상태 결정 로직**
```javascript
// frontend/src/utils/itemMappings.js
const determineStatus = (item, baseSeverity) => {
  const findings = item.findings || [];
  
  if (findings.length === 0) {
    return 'PASS';      // 문제 없음
  }
  
  return baseSeverity;  // CRITICAL 또는 WARN 상속
};
```

### 🎨 **UI 표시 규칙**
```javascript
// frontend/src/data/inspectionItems.js
export const severityColors = {
  CRITICAL: '#DC2626',  // 빨간색
  WARN: '#F59E0B',      // 노란색  
  PASS: '#10B981'       // 초록색
};

export const severityIcons = {
  CRITICAL: '🚨',
  WARN: '⚠️',
  PASS: '✅'
};
```

---

## 🏗️ 검사 항목 구조

### 📝 **기본 구조**
```javascript
// frontend/src/data/inspectionItems.js
export const inspectionItems = {
  [서비스명]: {
    id: '서비스ID',
    name: '서비스 표시명',
    description: '서비스 설명',
    icon: '아이콘',
    color: '색상',
    categories: [
      {
        id: '카테고리ID',
        name: '카테고리명',
        description: '카테고리 설명',
        items: [
          {
            id: '검사항목ID',
            name: '검사항목명',
            shortDescription: '간단 설명',
            description: '상세 설명',
            severity: 'CRITICAL' | 'WARN',
            enabled: true | false
          }
        ]
      }
    ]
  }
};
```

### 📋 **검사 항목 예시**
```javascript
{
  id: 'dangerous-ports',
  name: '보안 그룹 - 위험한 포트 노출',
  shortDescription: 'SSH, RDP 등 위험한 포트의 인터넷 노출 검사',
  description: 'SSH(22), RDP(3389), 데이터베이스 포트(3306, 5432, 1433) 등이 인터넷(0.0.0.0/0)에 개방되어 있는지 검사합니다. 이러한 포트가 공개되면 무차별 대입 공격의 위험이 높아집니다.',
  severity: 'CRITICAL',
  enabled: true
}
```

---

## 🔧 서비스별 검사 항목

### 🖥️ **EC2 (Amazon Elastic Compute Cloud)**

#### 🛡️ **보안 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `dangerous-ports` | 위험한 포트 노출 | CRITICAL | SSH, RDP 등 위험한 포트의 인터넷 노출 |
| `ebs-encryption` | EBS 볼륨 암호화 | CRITICAL | 암호화되지 않은 EBS 볼륨과 스냅샷 |
| `ebs-volume-version` | EBS 볼륨 버전 | WARN | 구형 볼륨 타입 및 GP3 업그레이드 |
| `termination-protection` | 종료 보호 설정 | WARN | 중요 인스턴스의 실수 삭제 방지 |

#### 💰 **비용 최적화 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `unused-security-groups` | 미사용 보안 그룹 | WARN | 인스턴스에 연결되지 않은 보안 그룹 |
| `unused-elastic-ip` | 미사용 Elastic IP | WARN | 중지된 인스턴스의 Elastic IP |
| `old-snapshots` | 오래된 스냅샷 | WARN | 90일 이상 된 스냅샷 정리 권장 |
| `stopped-instances` | 중지된 인스턴스 | WARN | 30일 이상 중지된 인스턴스 |

### 🗄️ **RDS (Amazon Relational Database Service)**

#### 🛡️ **보안 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `encryption` | 암호화 설정 | CRITICAL | 저장 시 및 전송 중 암호화 |
| `security-groups` | 데이터베이스 보안 그룹 | CRITICAL | 데이터베이스 접근 권한 및 네트워크 보안 |
| `public-access` | 퍼블릭 접근 설정 | CRITICAL | 불필요한 퍼블릭 접근 허용 여부 |

#### 🔄 **백업 및 복구 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `automated-backup` | 자동 백업 | CRITICAL | 자동 백업 활성화 및 보존 기간 |
| `snapshot-encryption` | 스냅샷 암호화 | WARN | 데이터베이스 스냅샷 암호화 설정 |

### 👤 **IAM (Identity and Access Management)**

#### 🛡️ **보안 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `root-access-key` | 루트 계정 액세스 키 | CRITICAL | 루트 계정의 액세스 키 존재 여부 |
| `mfa-enabled` | 다중 인증(MFA) 활성화 | CRITICAL | IAM 사용자 및 루트 계정의 MFA 설정 |
| `unused-credentials` | 장기 미사용 자격 증명 | WARN | 90일 이상 미사용 액세스 키 |

#### 📋 **정책 관리 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `overprivileged-user-policies` | 사용자 과도한 권한 | CRITICAL | 필요 이상의 권한을 가진 사용자 정책 |
| `overprivileged-role-policies` | 역할 과도한 권한 | CRITICAL | 필요 이상의 권한을 가진 역할 정책 |
| `inline-policies` | 인라인 정책 | WARN | 관리되지 않는 인라인 정책 사용 |
| `unused-policies` | 사용되지 않는 정책 | WARN | 연결되지 않은 정책 |

### 🪣 **S3 (Simple Storage Service)**

#### 🛡️ **보안 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `bucket-encryption` | S3 버킷 서버 측 암호화 | CRITICAL | 버킷의 기본 암호화 설정 |
| `bucket-public-access` | S3 버킷 퍼블릭 액세스 차단 | CRITICAL | 버킷의 퍼블릭 액세스 차단 설정 |
| `bucket-policy` | S3 버킷 정책 보안 | CRITICAL | 과도한 권한의 버킷 정책 |
| `bucket-cors` | CORS 설정 | WARN | 위험한 CORS 설정 및 와일드카드 |

#### 🔒 **데이터 보호 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `bucket-versioning` | 버전 관리 | WARN | 버킷의 버전 관리 활성화 여부 |
| `bucket-logging` | 액세스 로깅 | WARN | 버킷의 액세스 로깅 활성화 여부 |

#### 💰 **비용 최적화 카테고리**
| 검사 항목 ID | 이름 | Severity | 설명 |
|-------------|------|----------|------|
| `bucket-lifecycle` | 라이프사이클 정책 | WARN | 스토리지 클래스 전환 및 객체 만료 정책 |

---

## ➕ 새로운 검사 항목 추가

### 1️⃣ **프론트엔드 설정**

**1. 검사 항목 정의**
```javascript
// frontend/src/data/inspectionItems.js
{
  id: 'new-security-check',
  name: '새로운 보안 검사',
  shortDescription: '새로운 보안 취약점 검사',
  description: '상세한 검사 설명...',
  severity: 'CRITICAL',  // 또는 'WARN'
  enabled: true
}
```

### 2️⃣ **백엔드 Inspector 구현**

**1. Checker 파일 생성**
```javascript
// backend/services/inspectors/{service}/checks/newSecurityChecker.js
const InspectionFinding = require('../../../../models/InspectionFinding');

class NewSecurityChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  async runAllChecks(resources) {
    for (const resource of resources) {
      await this.checkResource(resource);
    }
  }

  async checkResource(resource) {
    // 검사 로직 구현
    const hasIssue = await this.performSecurityCheck(resource);
    
    if (hasIssue) {
      const finding = new InspectionFinding({
        resourceId: resource.id,
        resourceType: 'ResourceType',
        issue: '발견된 보안 문제 설명',
        recommendation: '해결 방법 권장사항'
      });
      
      this.inspector.addFinding(finding);
    }
  }

  async performSecurityCheck(resource) {
    // 실제 AWS API 호출 및 검사 로직
    return false; // 또는 true
  }
}

module.exports = NewSecurityChecker;
```

**2. Inspector에 Checker 등록**
```javascript
// backend/services/inspectors/{service}/index.js
const NewSecurityChecker = require('./checks/newSecurityChecker');

class ServiceInspector extends BaseInspector {
  async _inspectNewSecurityCheck(results) {
    const checker = new NewSecurityChecker(this);
    const resources = await this.getResources();
    await checker.runAllChecks(resources);
  }
}
```

### 3️⃣ **검사 항목 활성화**

**1. Inspector 매핑 추가**
```javascript
// backend/services/inspectors/{service}/index.js
const inspectionMethods = {
  'new-security-check': '_inspectNewSecurityCheck',
  // 기존 매핑들...
};
```

**2. 지원 항목 목록 업데이트**
```javascript
getSupportedInspectionTypes() {
  return [
    'new-security-check',
    // 기존 항목들...
  ];
}
```

### 4️⃣ **테스트 및 검증**

**1. 단위 테스트 작성**
```javascript
// backend/tests/inspectors/{service}/newSecurityChecker.test.js
describe('NewSecurityChecker', () => {
  it('should detect security issues', async () => {
    // 테스트 로직
  });
});
```

**2. 통합 테스트**
```javascript
// 실제 AWS 환경에서 검사 실행
// 예상 결과와 실제 결과 비교
```

---

## 🎯 모범 사례

### ✅ **DO (권장사항)**
1. **명확한 이름**: 검사 항목 ID와 이름을 명확하게 작성
2. **적절한 Severity**: 보안 영향도에 따라 CRITICAL/WARN 적절히 선택
3. **상세한 설명**: 사용자가 이해하기 쉬운 문제 설명과 해결 방법 제공
4. **효율적인 검사**: AWS API 호출을 최소화하고 배치 처리 활용
5. **에러 처리**: AWS API 에러에 대한 적절한 처리 및 로깅

### ❌ **DON'T (피해야 할 것)**
1. **중복 검사**: 이미 존재하는 검사와 중복되는 로직 작성
2. **과도한 API 호출**: 불필요한 AWS API 호출로 인한 성능 저하
3. **모호한 메시지**: 사용자가 이해하기 어려운 기술적 용어 사용
4. **하드코딩**: 설정값을 하드코딩하지 말고 환경변수나 설정 파일 사용
5. **에러 무시**: AWS API 에러를 무시하거나 부적절하게 처리

---

## 📚 참고 자료

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [AWS Security Best Practices](https://aws.amazon.com/security/security-learning/)
- [AWS Config Rules](https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html)
- [AWS Trusted Advisor](https://aws.amazon.com/support/trusted-advisor/)