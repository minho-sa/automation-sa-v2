# InspectionService 아키텍처 및 메서드 분류

## 🏗️ InspectionService 메서드 분류 및 역할

### 🔧 내부 정의 메서드 (InspectionService 클래스 내부)

#### 📋 초기화 및 설정
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `constructor()` | 서비스 초기화, Map 생성, 검사 단계 정의 | 서비스 인스턴스 생성 시 |
| `createLogger()` | 로깅 시스템 생성 | 생성자에서 호출 |

#### 🚀 검사 오케스트레이션
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `startInspection()` | **검사 프로세스 진입점**, 배치 관리, 비동기 실행 시작 | Controller에서 검사 시작 요청 시 |
| `executeItemInspectionAsync()` | **개별 항목 검사 실행**, 전체 검사 플로우 관리 | startInspection에서 각 항목별로 병렬 호출 |

#### 🔐 AWS 권한 관리
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `assumeRole()` | **AWS 계정 간 권한 위임**, 자격증명 획득 | executeItemInspectionAsync에서 검사 전 |

#### 📊 진행률 및 상태 추적
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `updateInspectionProgress()` | **실시간 진행률 계산 및 전송** | executeItemInspectionAsync에서 각 단계마다 |
| `calculateBatchProgress()` | **배치 전체 진행률 계산** | 개별 항목 완료 시마다 |

#### 💾 데이터 처리
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `saveInspectionItemResults()` | **검사 결과 저장 오케스트레이션** | executeItemInspectionAsync에서 검사 완료 후 |
| `handlePartialInspectionFailure()` | **부분 실패 시 데이터 보존** | executeItemInspectionAsync에서 오류 발생 시 |

#### 📡 알림 관리
| 메서드 | 역할 | 사용 시점 |
|--------|------|----------|
| `broadcastBatchCompletion()` | **배치 완료 알림 전송** | startInspection에서 모든 항목 완료 후 |

---

### 🌐 외부 정의 메서드 (다른 서비스/모듈)

#### 📡 WebSocketService (실시간 통신)
| 메서드 | 역할 | 호출 위치 |
|--------|------|----------|
| `broadcastProgressUpdate()` | **실시간 진행률 전송** | updateInspectionProgress, executeItemInspectionAsync, broadcastBatchCompletion |
| `broadcastStatusChange()` | **상태 변경 알림** | executeItemInspectionAsync (실패 시) |
| `broadcastInspectionComplete()` | **최종 완료 알림** | broadcastBatchCompletion |
| `moveSubscribersToBatch()` | **구독자 관리 최적화** | startInspection |
| `cleanupBatchSubscribers()` | **메모리 정리** | startInspection (완료 후) |

#### 🔐 STSService (AWS 보안)
| 메서드 | 역할 | 호출 위치 |
|--------|------|----------|
| `isValidArnFormat()` | **ARN 형식 검증** | assumeRole |
| `client.send()` | **AWS STS 명령 실행** | assumeRole |

#### 🔍 InspectorRegistry (검사 실행)
| 메서드 | 역할 | 호출 위치 |
|--------|------|----------|
| `getInspector()` | **서비스별 Inspector 인스턴스 생성** | executeItemInspectionAsync |

#### 💾 InspectionItemService (데이터 저장)
| 메서드 | 역할 | 호출 위치 |
|--------|------|----------|
| `saveItemResult()` | **DynamoDB에 검사 결과 저장** | saveInspectionItemResults |

---

## 🎯 역할별 메서드 사용 패턴

### 🚀 검사 시작 시
```
Controller → startInspection() (내부)
├── webSocketService.broadcastProgressUpdate() (외부)
├── webSocketService.moveSubscribersToBatch() (외부)
└── executeItemInspectionAsync() (내부) × N개 병렬
```

### ⚙️ 개별 검사 실행 시
```
executeItemInspectionAsync() (내부)
├── updateInspectionProgress() (내부)
│   └── webSocketService.broadcastProgressUpdate() (외부)
├── assumeRole() (내부)
│   ├── stsService.isValidArnFormat() (외부)
│   └── stsService.client.send() (외부)
├── inspectorRegistry.getInspector() (외부)
├── saveInspectionItemResults() (내부)
│   └── inspectionItemService.saveItemResult() (외부)
└── calculateBatchProgress() (내부)
```

### 📡 완료 알림 시
```
broadcastBatchCompletion() (내부)
├── webSocketService.broadcastProgressUpdate() (외부)
└── webSocketService.broadcastInspectionComplete() (외부)
```

---

## 📊 아키텍처 요약

### 메서드 분류
- **내부 메서드 (10개)**: 검사 로직과 플로우 제어
- **외부 메서드 (8개)**: 실제 작업 수행 (통신, 저장, 검사, 보안)

### 설계 원칙
- **내부**: 오케스트레이션 (검사 플로우 제어)
- **외부**: 실제 작업 수행 (구체적 기능 실행)
- **의존성 방향**: 내부 → 외부 (단방향 의존성)

### 아키텍처 장점
- ✅ **관심사 분리**: 각 메서드가 명확한 단일 책임
- ✅ **단일 책임 원칙**: 오케스트레이션 vs 실제 작업 분리
- ✅ **재사용성**: 내부 메서드들의 조합으로 다양한 검사 시나리오 지원
- ✅ **유지보수성**: 외부 서비스 변경 시 래핑 메서드만 수정
- ✅ **테스트 용이성**: 각 계층별 독립적 테스트 가능

### 래핑 패턴 사용 이유
1. **컨텍스트 특화**: 검사 전용 설정 및 로직 적용
2. **에러 처리 특화**: 검사 컨텍스트에 맞는 에러 메시지 및 로깅
3. **재사용성**: 동일한 검사 로직을 여러 곳에서 재사용
4. **유지보수성**: 검사 관련 로직 변경 시 한 곳에서만 수정

이런 구조로 **관심사 분리**와 **단일 책임 원칙**을 잘 지키고 있습니다!