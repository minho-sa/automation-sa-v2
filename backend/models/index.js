/**
 * Models Index
 * 모든 데이터 모델을 내보내는 인덱스 파일
 */

// 지연 로딩을 위한 getter 사용
module.exports = {
  get InspectionStatus() {
    return require('./InspectionStatus');
  },
  get InspectionFinding() {
    return require('./InspectionFinding');
  },
  get InspectionItemResult() {
    return require('./InspectionItemResult');
  },
  get ApiResponse() {
    return require('./ApiResponse').ApiResponse;
  },
  get ApiError() {
    return require('./ApiResponse').ApiError;
  },
  get User() {
    return require('./User');
  }
};