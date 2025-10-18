import { useState, useEffect } from 'react';
import { inspectionService } from '../../services';
import { 
  getItemName, 
  getItemInfo, 
  getItemSeverity, 
  getSeverityColor, 
  getSeverityIcon,
  determineInspectionStatus,
  getActualStatus,
  calculateStatusStats
} from '../../utils/itemMappings';
import './InspectionHistory.css';

const InspectionHistory = () => {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedInspection, setSelectedInspection] = useState(null);
  // 단순화된 필터 (서비스 타입만)
  const [filters, setFilters] = useState({
    serviceType: 'all',
    historyMode: 'history' // 'latest' 또는 'history'
  });
  const [pagination, setPagination] = useState({
    hasMore: false,
    lastEvaluatedKey: null,
    loading: false
  });



  // 컴포넌트 마운트 시 히스토리 로드
  useEffect(() => {
    loadInspectionHistory();
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps



  // 실제 데이터를 검사 항목 단위로 그룹화 - 새로운 CRITICAL/WARN 모델 사용
  const enrichItemData = (items) => {
    return items.map((item) => {
      // 검사 요약 생성
      const findingsCount = item.findings ? item.findings.length : 0;
      const resourcesAffected = item.findings ?
        [...new Set(item.findings.map(f => f.resourceId))].length : 0;

      // 기본 severity와 실제 상태 결정
      const baseSeverity = getItemSeverity(item.serviceType, item.itemId);
      const actualStatus = getActualStatus(item);

      return {
        // 기본 정보
        inspectionId: item.lastInspectionId,
        serviceType: item.serviceType,
        itemId: item.itemId,

        // 검사 항목 정보 (inspectionItems.js에서 name과 severity 함께 가져옴)
        inspectionTitle: getItemName(item.serviceType, item.itemId),
        checkName: item.itemId?.toUpperCase().replace(/_/g, '-') || `${item.serviceType}-CHECK`,
        category: getItemInfo(item.serviceType, item.itemId)?.categoryName || '보안 검사',
        
        // 새로운 severity 시스템
        baseSeverity: baseSeverity,        // 기본 severity (CRITICAL 또는 WARN)
        actualStatus: actualStatus,        // 실제 상태 (CRITICAL, WARN, PASS)
        severity: actualStatus,            // UI 호환성을 위해 actualStatus를 severity로 사용

        // 검사 요약
        findingsCount: findingsCount,
        resourcesAffected: resourcesAffected,
        status: item.status,

        // 시간 정보
        timestamp: new Date(item.inspectionTime || Date.now()).toISOString(),

        // 원본 데이터 보존 (상세보기에서 사용)
        originalItem: item,
        findings: item.findings || [],
        recommendations: item.recommendations || [],
        
        // 정렬용 실제 검사 시간 보존
        actualInspectionTime: item.inspectionTime
      };
    });
  };

  // 검사 히스토리 로드 (페이지네이션 지원)
  const loadInspectionHistory = async (loadMore = false) => {
    try {
      if (loadMore) {
        setPagination(prev => ({ ...prev, loading: true }));
      } else {
        setLoading(true);
      }
      setError(null);

      const params = {
        // limit 파라미터 제거 - 백엔드가 적절한 양을 결정
        ...(filters.serviceType !== 'all' && { serviceType: filters.serviceType }),
        historyMode: filters.historyMode
      };

      // 더 보기인 경우 lastEvaluatedKey 추가
      if (loadMore && pagination.lastEvaluatedKey) {
        params.lastEvaluatedKey = pagination.lastEvaluatedKey;
      }

      console.log('🔍 [InspectionHistory] Loading history:', {
        params,
        loadMore,
        hasLastKey: !!params.lastEvaluatedKey
      });

      // 항목별 검사 이력 조회
      const result = await inspectionService.getItemInspectionHistory(params);

      if (result.success) {
        let newData = result.data.items || [];

        // 실제 데이터를 표시용으로 변환
        newData = enrichItemData(newData);

        const finalData = loadMore ? [...historyData, ...newData] : newData;
        
        setHistoryData(finalData);
        setPagination({
          hasMore: result.data.hasMore || false,
          lastEvaluatedKey: result.data.lastEvaluatedKey,
          loading: false
        });

        console.log('✅ [InspectionHistory] Loaded history:', {
          newItems: newData.length,
          totalItems: finalData.length,
          hasMore: result.data.hasMore,
          actualPageSize: newData.length // 실제 받은 데이터 개수
        });
      } else {
        throw new Error(result.error?.message || '히스토리를 불러오는데 실패했습니다.');
      }
    } catch (error) {
      console.error('❌ [InspectionHistory] Load failed:', error);
      setError(`데이터를 불러오는데 실패했습니다: ${error.message}`);
      if (!loadMore) {
        setHistoryData([]);
      }
      setPagination(prev => ({ 
        ...prev, 
        hasMore: false, 
        loading: false,
        ...(loadMore ? {} : { lastEvaluatedKey: null })
      }));
    } finally {
      if (!loadMore) {
        setLoading(false);
      }
    }
  };

  // 더 많은 데이터 로드
  const loadMore = () => {
    if (pagination.hasMore && !loading && !pagination.loading) {
      console.log('📄 [InspectionHistory] Loading more items...');
      loadInspectionHistory(true);
    }
  };



  // 필터 변경 핸들러 (페이지네이션 리셋)
  const handleFilterChange = (filterType, value) => {
    console.log('🔄 [InspectionHistory] Filter changed:', filterType, value);
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));
    // 필터 변경 시 페이지네이션 리셋
    setPagination({ hasMore: false, lastEvaluatedKey: null, loading: false });
    setHistoryData([]); // 기존 데이터 클리어
  };



  // 항목 상세 보기 (항목별 보기용)
  const handleViewItemDetails = (item) => {

    // 검사 항목의 모든 findings를 포함한 상세 데이터 생성
    const inspectionData = {
      inspectionId: item.inspectionId,
      serviceType: item.serviceType,
      startTime: item.timestamp,
      endTime: item.timestamp,
      duration: 0,
      itemName: item.inspectionTitle,
      results: {
        summary: {
          totalIssues: item.findings ? item.findings.length : 0,
          severity: getItemSeverity(item.serviceType, item.itemId)
        },
        findings: item.findings || []
      }
    };

    setSelectedInspection(inspectionData);
  };

  // 시간 포맷팅
  const formatDateTime = (timestamp) => {
    return new Date(timestamp).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 상태 처리 통합 함수들
  const getStatusIcon = (status) => {
    const statusIcons = {
      'PASS': '🟢',
      'FAIL': '🔴',
      'NOT_CHECKED': '⚪',
      // 레거시 상태 지원
      'COMPLETED': '🟢',
      'FAILED': '🔴',
      'PENDING': '⚪',
      'IN_PROGRESS': '🟡'
    };
    return statusIcons[status] || '⚪';
  };

  const getStatusText = (status) => {
    const statusTexts = {
      'PASS': '검사 완료',
      'FAIL': '문제 발견',
      'NOT_CHECKED': '검사 대상 없음',
      // 레거시 상태 지원
      'COMPLETED': '검사 완료',
      'FAILED': '문제 발견',
      'PENDING': '검사 대기',
      'IN_PROGRESS': '검사 진행 중'
    };
    return statusTexts[status] || '상태 불명';
  };

  const getStatusColor = (status) => {
    const statusColors = {
      'PASS': '#059669',
      'FAIL': '#dc2626',
      'NOT_CHECKED': '#6b7280',
      // 레거시 상태 지원
      'COMPLETED': '#059669',
      'FAILED': '#dc2626',
      'PENDING': '#6b7280',
      'IN_PROGRESS': '#d97706'
    };
    return statusColors[status] || '#6b7280';
  };

  // 상태 정규화 함수 - 모든 상태를 표준 검사 항목별 상태로 변환
  const normalizeStatus = (status) => {
    const statusMapping = {
      'COMPLETED': 'PASS',
      'FAILED': 'FAIL',
      'PENDING': 'NOT_CHECKED',
      'IN_PROGRESS': 'NOT_CHECKED',
      // WARNING은 FAIL로 통합 (문제가 있는 것으로 간주)
      'WARNING': 'FAIL',
      // 이미 정규화된 상태는 그대로
      'PASS': 'PASS',
      'FAIL': 'FAIL',
      'NOT_CHECKED': 'NOT_CHECKED'
    };
    return statusMapping[status] || 'NOT_CHECKED';
  };



  // 검사 결과 요약 생성 - 새로운 CRITICAL/WARN/PASS 모델 사용
  const getResultSummary = (item) => {
    const findings = item.findings || [];
    const findingsCount = item.findingsCount || findings.length || 0;
    const actualStatus = item.actualStatus || item.severity;

    if (actualStatus === 'PASS' || findingsCount === 0) {
      return (
        <div className="summary-text success">
          <span className="summary-icon">✅</span>
          <span>정상</span>
        </div>
      );
    }

    // 심각도에 따른 아이콘과 색상 결정
    const severityIcon = getSeverityIcon(actualStatus);
    const severityColor = getSeverityColor(actualStatus);

    return (
      <div className="summary-text warning" style={{ color: severityColor }}>
        <span className="summary-icon">{severityIcon}</span>
        <span>{findingsCount}개 문제 ({actualStatus})</span>
      </div>
    );
  };



  return (
    <div className="inspection-history">
      {/* 콤팩트 헤더 */}
      <div className="header-compact">
        <div className="header-left">
          <span className="header-icon-compact">📊</span>
          <h1>검사 히스토리</h1>
        </div>
        <div className="header-right">
          <span className="total-count">{historyData.length}개 기록</span>
        </div>
      </div>

      {/* 단순화된 필터 */}
      <div className="filters-compact">
        <select
          value={filters.serviceType}
          onChange={(e) => handleFilterChange('serviceType', e.target.value)}
          className="filter-mini"
        >
          <option value="all">모든 서비스</option>
          <option value="EC2">🖥️ EC2</option>
          <option value="RDS">🗄️ RDS</option>
          <option value="S3">🪣 S3</option>
          <option value="IAM">👤 IAM</option>
        </select>



        <button
          className="btn-mini"
          onClick={() => loadInspectionHistory()}
          disabled={loading}
          title="새로고침"
        >
          {loading ? '⏳' : '🔄'}
        </button>

        <button
          className="btn-mini"
          onClick={() => {
            const resetFilters = {
              serviceType: 'all',
              historyMode: 'history'
            };
            setFilters(resetFilters);
            setPagination(prev => ({ 
              ...prev, 
              hasMore: false, 
              lastEvaluatedKey: null, 
              loading: false 
            }));
            setHistoryData([]); // 기존 데이터 클리어
          }}
          disabled={loading || pagination.loading}
          title="초기화"
        >
          🗑️
        </button>
      </div>

      {/* 에러 표시 */}
      {error && (
        <div className="error-alert">
          <span className="error-icon">⚠️</span>
          <span className="error-message">{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* 콤팩트 히스토리 목록 */}
      <div className="history-content-compact">
        {historyData.length === 0 && !loading ? (
          <div className="empty-compact">
            <span className="empty-icon-mini">📊</span>
            <span>검사 기록이 없습니다</span>
            <button
              className="start-btn-mini"
              onClick={() => window.location.href = '/inspection'}
            >
              검사 시작
            </button>
          </div>
        ) : (
          <div className="history-list-compact">
            {historyData.map((item, index) => {
              const normalizedStatus = normalizeStatus(item.status);

              return (
                <div key={`${item.itemId}-${index}`} className={`history-row-compact status-${normalizedStatus.toLowerCase()}`}>
                  {/* 서비스 + 검사명 */}
                  <div className="row-service">
                    <span className="service-icon-mini">
                      {item.serviceType === 'EC2' ? '🖥️' :
                        item.serviceType === 'S3' ? '🪣' :
                          item.serviceType === 'RDS' ? '🗄️' :
                            item.serviceType === 'IAM' ? '👤' : '🔧'}
                    </span>
                    <div className="service-info-mini">
                      <span className="inspection-title-mini">{item.inspectionTitle}</span>
                      <span className="service-name-mini">{item.serviceType}</span>
                    </div>
                  </div>

                  {/* 리전 */}
                  <div className="row-region">
                    <span className="region-icon">🌍</span>
                    <span className="region-text">
                      {item.originalItem?.region || item.region || 'us-east-1'}
                    </span>
                  </div>

                  {/* 검사 결과 요약 */}
                  <div className="row-summary">
                    {getResultSummary(item)}
                  </div>

                  {/* 심각도 */}
                  <div className="row-severity">
                    <span 
                      className="severity-badge-compact"
                      style={{ 
                        backgroundColor: getSeverityColor(item.actualStatus || item.severity) + '20',
                        color: getSeverityColor(item.actualStatus || item.severity),
                        borderColor: getSeverityColor(item.actualStatus || item.severity) + '40'
                      }}
                    >
                      {item.actualStatus || item.severity}
                    </span>
                  </div>

                  {/* 시간 */}
                  <div className="row-time">
                    <div className="time-display">
                      <span className="time-date">
                        {item.timestamp ? formatDate(item.timestamp) : '날짜 없음'}
                      </span>
                      <span className="time-full" title={item.timestamp ? formatDateTime(item.timestamp) : '시간 정보 없음'}>
                        {item.timestamp ? formatTime(item.timestamp) : '--:--'}
                      </span>
                    </div>
                  </div>

                  {/* 상세보기 */}
                  <div className="row-action">
                    <button
                      className="details-btn-mini"
                      onClick={() => handleViewItemDetails(item)}
                      title="상세보기"
                    >
                      📋
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 더 보기 버튼 (페이지네이션) */}
        {pagination.hasMore && (
          <div className="load-more-modern">
            <button
              className="load-more-btn-modern"
              onClick={loadMore}
              disabled={loading || pagination.loading}
            >
              {pagination.loading ? (
                <>
                  <span className="loading-spinner-modern"></span>
                  더 불러오는 중...
                </>
              ) : (
                <>
                  <span className="load-icon-modern">📄</span>
                  더 많은 기록 보기
                </>
              )}
            </button>
            <div className="pagination-info">
              현재 {historyData.length}개 표시됨
            </div>
          </div>
        )}

        {/* 페이지네이션 완료 메시지 */}
        {!pagination.hasMore && historyData.length > 0 && (
          <div className="pagination-complete">
            <span className="complete-icon">✅</span>
            <span>모든 기록을 불러왔습니다 (총 {historyData.length}개)</span>
          </div>
        )}
      </div>

      {/* 개선된 상세 모달 */}
      {selectedInspection && (
        <div className="modal-overlay-modern" onClick={() => setSelectedInspection(null)}>
          <div className="modal-container-modern" onClick={(e) => e.stopPropagation()}>
            {/* 모달 헤더 */}
            <div className="modal-header-modern">
              <div className="modal-title-section">
                <div className="modal-service-icon">
                  {selectedInspection.serviceType === 'EC2' ? '🖥️' :
                    selectedInspection.serviceType === 'S3' ? '🪣' :
                      selectedInspection.serviceType === 'RDS' ? '🗄️' :
                        selectedInspection.serviceType === 'IAM' ? '👤' : '🔧'}
                </div>
                <div className="modal-title-text">
                  <h2>{selectedInspection.itemName || '검사 상세 정보'}</h2>
                  <span className="modal-service-name">{selectedInspection.serviceType} 검사</span>
                </div>
              </div>
              <button
                className="modal-close-modern"
                onClick={() => setSelectedInspection(null)}
                aria-label="모달 닫기"
              >
                ✕
              </button>
            </div>

            {/* 모달 콘텐츠 */}
            <div className="modal-content-modern">
              {/* 검사 요약 카드 */}
              <div className="inspection-summary-card">
                <div className="summary-header">
                  <h3>📊 검사 요약</h3>
                  <div className="inspection-id">ID: {selectedInspection.inspectionId}</div>
                </div>

                <div className="summary-stats">
                  <div className="stat-item-large total">
                    <span className="stat-icon">📊</span>
                    <div className="stat-content">
                      <span className="stat-value">{selectedInspection.results?.summary?.totalIssues || 0}</span>
                      <span className="stat-label">총 문제</span>
                    </div>
                  </div>

                  <div className="stat-item-large severity" style={{ 
                    backgroundColor: getSeverityColor(selectedInspection.results?.summary?.severity || 'WARN') + '20',
                    borderColor: getSeverityColor(selectedInspection.results?.summary?.severity || 'WARN')
                  }}>
                    <span className="stat-icon">{getSeverityIcon(selectedInspection.results?.summary?.severity || 'WARN')}</span>
                    <div className="stat-content">
                      <span className="stat-value">{selectedInspection.results?.summary?.severity || 'WARN'}</span>
                      <span className="stat-label">심각도</span>
                    </div>
                  </div>
                </div>

                <div className="inspection-metadata">
                  <div className="metadata-item">
                    <span className="metadata-label">🕐 검사 시간</span>
                    <span className="metadata-value">{formatDateTime(selectedInspection.startTime)}</span>
                  </div>
                  {selectedInspection.duration && (
                    <div className="metadata-item">
                      <span className="metadata-label">⏱️ 소요 시간</span>
                      <span className="metadata-value">{Math.round(selectedInspection.duration / 1000)}초</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 검사 결과 섹션 */}
              {selectedInspection.results?.findings && selectedInspection.results.findings.length > 0 ? (
                <div className="findings-section-modern">
                  <div className="section-header-modern">
                    <h3>🔍 발견된 문제</h3>
                    <span className="findings-count">{selectedInspection.results.findings.length}개 문제</span>
                  </div>

                  <div className="findings-grid-modern">
                    {selectedInspection.results.findings.map((finding, index) => (
                      <div key={index} className="finding-card-modern">
                        <div className="finding-card-content">
                          <div className="resource-info-modern">
                            <span className="resource-type">{finding.resourceType}</span>
                            <span className="resource-id">{finding.resourceId}</span>
                          </div>

                          <div className="issue-description">
                            <div className="issue-title">
                              <span className="issue-icon">🚨</span>
                              <strong>문제</strong>
                            </div>
                            <p>{finding.issue}</p>
                          </div>

                          {finding.recommendation && (
                            <div className="recommendation-description">
                              <div className="recommendation-title">
                                <span className="recommendation-icon">💡</span>
                                <strong>권장사항</strong>
                              </div>
                              <p>{finding.recommendation}</p>
                            </div>
                          )}

                          {/* timestamp 제거 - 검사 시간은 상위 레벨에서 관리 */}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="no-findings-modern">
                  <div className="no-findings-content">
                    {selectedInspection.itemName?.includes('키 페어') || selectedInspection.itemName?.includes('메타데이터') ? (
                      <>
                        <div className="no-findings-icon">📋</div>
                        <h3>검사 대상이 없습니다</h3>
                        <p>현재 AWS 계정에 활성 상태의 리소스가 없어 이 항목을 검사할 수 없습니다.</p>
                        <p>관련 리소스를 생성한 후 다시 검사해보세요.</p>
                      </>
                    ) : (
                      <>
                        <div className="no-findings-icon success">✅</div>
                        <h3>문제가 발견되지 않았습니다</h3>
                        <p>이 검사 항목에서는 보안 문제나 개선이 필요한 사항이 발견되지 않았습니다.</p>
                        <p>현재 설정이 AWS 보안 모범 사례를 준수하고 있습니다.</p>
                      </>
                    )}
                  </div>
                </div>
              )}


            </div>

            {/* 모달 푸터 */}
            <div className="modal-footer-modern">
              <button
                className="modal-close-btn-modern"
                onClick={() => setSelectedInspection(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InspectionHistory;