# 📚 AWS 보안 검사 시스템 문서

## 🎯 개요

이 폴더는 AWS 보안 검사 시스템의 **아키텍처, 프로세스, 데이터 모델**에 대한 종합적인 문서를 제공합니다.

---

## 📋 문서 목록

| 문서 | 설명 | 대상 독자 |
|------|------|-----------|
| **[inspection-process.md](./inspection-process.md)** | 🔍 검사 프로세스 전체 흐름 | 개발자, 운영자 |
| **[data-models.md](./data-models.md)** | 📊 데이터 모델 구조 및 역할 | 개발자, 아키텍트 |
| **[inspection-items.md](./inspection-items.md)** | 🔧 검사 항목 설정 및 추가 | 개발자, 보안 담당자 |

---

## 🏗️ 시스템 아키텍처 개요

### 🎨 **프론트엔드 (React)**
```
src/
├── components/          # UI 컴포넌트
├── data/
│   └── inspectionItems.js  # 검사 항목 정의 (Severity 포함)
├── utils/
│   └── itemMappings.js     # 상태 결정 로직
└── services/           # API 통신
```

### 🔧 **백엔드 (Node.js)**
```
backend/
├── controllers/        # API 엔드포인트
├── services/          # 비즈니스 로직
│   ├── inspectionService.js      # 검사 실행 조정
│   ├── inspectionItemService.js  # 결과 저장/조회
│   ├── historyService.js        # 히스토리 관리
│   ├── websocketService.js      # 실시간 통신
│   └── inspectors/              # 검사 로직
│       ├── baseInspector.js     # 기본 클래스
│       ├── ec2/                 # EC2 검사
│       ├── iam/                 # IAM 검사
│       └── s3/                  # S3 검사
├── models/            # 데이터 모델
└── routes/           # API 라우팅
```

### 💾 **데이터베이스 (DynamoDB)**
```
InspectionItemResults 테이블
├── LATEST 레코드    # 최신 결과 (빠른 조회)
└── HISTORY 레코드   # 히스토리 (시간순 정렬)
```

---

## 🔄 핵심 데이터 흐름

### 1️⃣ **검사 실행**
```
사용자 요청 → Controller → InspectionService → Inspector → Checker → AWS API
```

### 2️⃣ **문제 발견**
```
AWS 리소스 → 보안 규칙 검증 → InspectionFinding 생성 → BaseInspector 수집
```

### 3️⃣ **결과 저장**
```
InspectionFinding[] → InspectionItemService → DynamoDB (LATEST + HISTORY)
```

### 4️⃣ **실시간 알림**
```
검사 진행률 → WebSocketService → 클라이언트 → UI 업데이트
```

### 5️⃣ **상태 결정**
```
검사 항목 Severity + Findings 배열 → 최종 상태 (CRITICAL/WARN/PASS)
```

---

## 🎯 핵심 설계 원칙

### 1. **관심사 분리**
- **백엔드**: 검사 실행 + 데이터 수집
- **프론트엔드**: Severity 정의 + 상태 결정 + UI 표시

### 2. **단순성**
- 복잡한 트랜잭션 로직 제거
- 불필요한 중간 레이어 제거
- 명확한 데이터 모델

### 3. **확장성**
- 서비스별 Inspector 분리
- 검사 항목별 독립적 저장
- 효율적인 DynamoDB 키 설계

### 4. **실시간성**
- WebSocket 기반 진행률 추적
- 즉시 피드백 제공
- 사용자 경험 최적화

---

## 🚀 주요 기능

### ✅ **검사 기능**
- **단일 항목 검사**: 특정 보안 항목만 검사
- **배치 검사**: 여러 항목 동시 검사
- **실시간 진행률**: WebSocket으로 실시간 피드백
- **에러 처리**: 부분 실패 시에도 결과 저장

### 📊 **결과 관리**
- **최신 상태**: LATEST 레코드로 빠른 조회
- **히스토리**: 시간순 정렬된 검사 이력
- **상태 추적**: CRITICAL/WARN/PASS 3단계
- **상세 정보**: 리소스별 문제점과 해결 방안

### 🔍 **검사 항목**
- **EC2**: 보안 그룹, EBS 암호화, 비용 최적화
- **IAM**: MFA, 권한 관리, 자격 증명
- **S3**: 버킷 보안, 암호화, 접근 제어
- **RDS**: 데이터베이스 보안, 백업 설정

---

## 🛠️ 개발 가이드

### 📖 **문서 읽기 순서**
1. **[inspection-process.md](./inspection-process.md)** - 전체 프로세스 이해
2. **[data-models.md](./data-models.md)** - 데이터 구조 파악
3. **[inspection-items.md](./inspection-items.md)** - 검사 항목 설정

### 🔧 **새로운 검사 항목 추가**
1. 프론트엔드에서 검사 항목 정의 (Severity 포함)
2. 백엔드에서 Checker 구현
3. Inspector에 Checker 등록
4. 테스트 및 검증

### 🐛 **디버깅 가이드**
1. **검사 실패**: Inspector 로그 확인
2. **저장 실패**: InspectionItemService 로그 확인
3. **WebSocket 문제**: 연결 상태 및 메시지 확인
4. **상태 오류**: 프론트엔드 상태 결정 로직 확인

---

## 📈 성능 최적화

### ⚡ **빠른 조회**
- LATEST 레코드로 최신 상태 즉시 조회
- GSI(Global Secondary Index)로 다양한 조회 패턴 지원
- 효율적인 DynamoDB 키 설계

### 🔄 **확장성**
- 검사 항목별 독립적 처리
- 서비스별 Inspector 분리
- 배치 처리로 동시 검사 지원

### 📡 **실시간성**
- WebSocket으로 즉시 피드백
- 진행률 실시간 업데이트
- 에러 발생 시 즉시 알림

---

## 🔒 보안 고려사항

### 🛡️ **인증 및 권한**
- JWT 토큰 기반 인증
- AWS IAM Role 기반 권한 관리
- 사용자별 데이터 격리

### 🔐 **데이터 보호**
- AWS 자격 증명 안전한 처리
- 민감한 정보 로깅 방지
- HTTPS/WSS 암호화 통신

### 📊 **감사 추적**
- 모든 검사 활동 로깅
- 사용자 행동 추적
- 에러 및 예외 상황 기록

---

## 📚 추가 자료

### 🔗 **외부 문서**
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [AWS Security Best Practices](https://aws.amazon.com/security/security-learning/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)

### 🛠️ **개발 도구**
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/)
- [React Documentation](https://reactjs.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

## 📞 지원 및 문의

시스템 관련 문의사항이나 개선 제안이 있으시면 개발팀에 연락해 주세요.

**문서 업데이트**: 2024년 10월 14일