/**
 * Inspection Service (최적화됨)
 * 검사 오케스트레이션 서비스
 * 
 * 핵심 기능만 유지:
 * - 검사 시작 및 실행
 * - 검사 상태 조회
 * - 검사 결과 조회
 * - Assume Role 처리
 */

const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { v4: uuidv4 } = require('uuid');
const InspectionResult = require('../models/InspectionResult');
const InspectionStatus = require('../models/InspectionStatus');
const inspectorRegistry = require('./inspectors');
const webSocketService = require('./websocketService');

class InspectionService {
  constructor() {
    this.stsClient = null;
    this.activeInspections = new Map();
    this.activeBatches = new Map();

    // 검사 단계 정의
    this.inspectionSteps = {
      'EC2': [
        { name: 'Initializing EC2 inspection', weight: 5 },
        { name: 'Assuming role in customer account', weight: 10 },
        { name: 'Retrieving security groups', weight: 15 },
        { name: 'Analyzing security group rules', weight: 25 },
        { name: 'Retrieving EC2 instances', weight: 15 },
        { name: 'Analyzing instance configurations', weight: 20 },
        { name: 'Finalizing inspection results', weight: 10 }
      ],
      'S3': [
        { name: 'Initializing S3 inspection', weight: 10 },
        { name: 'Assuming role in customer account', weight: 15 },
        { name: 'Retrieving S3 buckets', weight: 20 },
        { name: 'Analyzing bucket configurations', weight: 35 },
        { name: 'Finalizing inspection results', weight: 20 }
      ],
      'IAM': [
        { name: 'Initializing IAM inspection', weight: 10 },
        { name: 'Assuming role in customer account', weight: 15 },
        { name: 'Retrieving IAM resources', weight: 25 },
        { name: 'Analyzing IAM policies', weight: 30 },
        { name: 'Finalizing inspection results', weight: 20 }
      ],
      'default': [
        { name: 'Initializing inspection', weight: 10 },
        { name: 'Assuming role in customer account', weight: 20 },
        { name: 'Performing service inspection', weight: 50 },
        { name: 'Finalizing inspection results', weight: 20 }
      ]
    };

    this.logger = this.createLogger();
  }

  /**
   * 검사 시작
   * @param {string} customerId - 고객 ID
   * @param {string} serviceType - 검사할 서비스 타입
   * @param {string} assumeRoleArn - 고객 계정의 역할 ARN
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<Object>} 검사 시작 응답
   */
  async startInspection(customerId, serviceType, assumeRoleArn, inspectionConfig = {}) {
    const batchId = uuidv4();
    const selectedItems = inspectionConfig.selectedItems || [];

    try {
      const inspectionJobs = [];

      this.logger.info('Processing inspection request', {
        customerId,
        serviceType,
        selectedItemsCount: selectedItems.length,
        selectedItems: selectedItems
      });

      if (selectedItems.length === 0) {
        // 전체 검사
        const inspectionId = uuidv4();
        inspectionJobs.push({
          inspectionId,
          itemId: 'all'
        });
      } else {
        // 선택된 항목별 검사
        for (const itemId of selectedItems) {
          const inspectionId = uuidv4();
          inspectionJobs.push({
            inspectionId,
            itemId: itemId
          });
        }
      }

      // 배치 정보 등록
      this.activeBatches.set(batchId, {
        inspectionIds: inspectionJobs.map(job => job.inspectionId),
        completedIds: [],
        totalItems: inspectionJobs.length,
        startTime: Date.now()
      });

      // 각 검사 작업의 상태 초기화
      for (const job of inspectionJobs) {
        const inspectionStatus = new InspectionStatus({
          inspectionId: job.inspectionId,
          status: 'PENDING',
          batchId,
          itemId: job.itemId
        });

        this.activeInspections.set(job.inspectionId, inspectionStatus);

        // 검사 시작 상태 저장
        await this.saveInspectionStart(customerId, job.inspectionId, serviceType, assumeRoleArn, {
          batchId,
          itemId: job.itemId
        });
      }

      // 비동기로 각 검사 실행
      const executionPromises = inspectionJobs.map(job => {
        // WebSocket 초기 상태 전송
        if (inspectionJobs.indexOf(job) === 0) {
          webSocketService.broadcastProgressUpdate(batchId, {
            status: 'STARTING',
            progress: {
              percentage: 0,
              completedItems: 0,
              totalItems: inspectionJobs.length,
              currentStep: `Starting batch inspection (${inspectionJobs.length} items)`,
              estimatedTimeRemaining: null
            },
            batchInfo: {
              batchId,
              totalInspections: inspectionJobs.length,
              completedInspections: 0,
              remainingInspections: inspectionJobs.length
            }
          });
        }

        webSocketService.broadcastStatusChange(batchId, {
          status: 'STARTING',
          message: `Starting ${job.itemId} inspection`,
          timestamp: Date.now(),
          itemId: job.itemId,
          inspectionId: job.inspectionId
        });

        // 구독자 이동
        setTimeout(() => {
          webSocketService.moveSubscribersToBatch(job.inspectionId, batchId);
        }, 100);

        return this.executeItemInspectionAsync(
          customerId,
          job.inspectionId,
          serviceType,
          assumeRoleArn,
          {
            ...inspectionConfig,
            targetItemId: job.itemId,
            batchId,
            isFirstInBatch: inspectionJobs.indexOf(job) === 0,
            firstInspectionId: inspectionJobs[0]?.inspectionId
          }
        ).catch(error => {
          this.logger.error('Async item inspection execution failed', {
            inspectionId: job.inspectionId,
            itemId: job.itemId,
            error: error.message
          });

          const status = this.activeInspections.get(job.inspectionId);
          if (status) {
            status.fail(error.message);
          }
        });
      });

      // 강제 구독자 이동
      setTimeout(() => {
        webSocketService.forceMoveToBatch(batchId, inspectionJobs.map(job => job.inspectionId));
      }, 1000);

      // 모든 검사 완료 처리
      Promise.all(executionPromises).then(() => {
        console.log(`🎯 [InspectionService] Batch ${batchId} completed - all ${inspectionJobs.length} inspections finished`);
        this.broadcastBatchCompletion(batchId, inspectionJobs);

        setTimeout(() => {
          console.log(`🧹 [InspectionService] Cleaning up batch ${batchId} subscribers`);
          webSocketService.cleanupBatchSubscribers(batchId, inspectionJobs.map(job => job.inspectionId));
        }, 5000);
      }).catch(error => {
        this.broadcastBatchCompletion(batchId, inspectionJobs, error);
      }).finally(() => {
        setTimeout(() => {
          this.activeBatches.delete(batchId);
        }, 10000);
      });

      return {
        success: true,
        data: {
          batchId,
          subscriptionId: inspectionJobs[0]?.inspectionId || batchId,
          inspectionJobs: inspectionJobs.map(job => ({
            inspectionId: job.inspectionId,
            itemId: job.itemId,
            status: 'PENDING'
          })),
          message: `Started ${inspectionJobs.length} inspection(s) successfully`,
          websocketInstructions: {
            subscribeToId: inspectionJobs[0]?.inspectionId || batchId,
            batchId: batchId,
            message: 'Subscribe to the first inspection ID - will be automatically moved to batch updates'
          }
        }
      };

    } catch (error) {
      this.logger.error('Failed to start inspection', {
        customerId,
        serviceType,
        error: error.message
      });

      return {
        success: false,
        error: {
          code: 'INSPECTION_START_FAILED',
          message: error.message
        }
      };
    }
  }

  /**
   * 개별 항목 검사 실행
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @param {string} serviceType - 서비스 타입
   * @param {string} assumeRoleArn - 역할 ARN
   * @param {Object} inspectionConfig - 검사 설정
   */
  async executeItemInspectionAsync(customerId, inspectionId, serviceType, assumeRoleArn, inspectionConfig) {
    const inspectionStatus = this.activeInspections.get(inspectionId);
    const steps = this.inspectionSteps[serviceType] || this.inspectionSteps.default;
    let currentStepIndex = 0;
    let inspector = null;

    try {
      // 검사 시작
      inspectionStatus.start(`Initializing ${inspectionConfig.targetItemId} inspection`);
      this.updateInspectionProgress(inspectionId, steps, currentStepIndex);

      // 1. Assume Role 수행
      currentStepIndex++;
      this.updateInspectionProgress(inspectionId, steps, currentStepIndex);
      const awsCredentials = await this.assumeRole(assumeRoleArn, inspectionId);

      // 2. Inspector 가져오기
      currentStepIndex++;
      this.updateInspectionProgress(inspectionId, steps, currentStepIndex);
      inspector = inspectorRegistry.getInspector(serviceType);
      if (!inspector) {
        throw new Error(`Inspector not found for service type: ${serviceType}`);
      }

      // 3. 검사 수행
      const inspectionResult = await inspector.executeItemInspection(
        customerId,
        inspectionId,
        awsCredentials,
        {
          ...inspectionConfig,
          targetItem: inspectionConfig.targetItemId
        }
      );

      // 검사 진행률 동기화
      this.syncInspectionProgress(inspectionId, inspector, steps, currentStepIndex);

      // 4. 검사 완료 처리
      currentStepIndex = steps.length - 1;
      this.updateInspectionProgress(inspectionId, steps, currentStepIndex);
      inspectionStatus.complete();

      // 5. 결과 저장
      console.log(`💾 [InspectionService] Starting DB save for ${inspectionId}`);
      let saveSuccessful = false;

      try {
        console.log(`💾 [InspectionService] Attempting transaction save for ${inspectionId}`);
        await this.saveInspectionResultWithTransaction(inspectionResult);
        saveSuccessful = true;
        console.log(`✅ [InspectionService] Transaction save successful for ${inspectionId}`);
      } catch (saveError) {
        console.error(`❌ [InspectionService] Transaction save failed for ${inspectionId}:`, {
          error: saveError.message,
          stack: saveError.stack
        });

        try {
          console.log(`🚨 [InspectionService] Attempting emergency save for ${inspectionId}`);
          await this.emergencySaveInspectionResult(inspectionResult);
          saveSuccessful = true;
          console.log(`✅ [InspectionService] Emergency save successful for ${inspectionId}`);
        } catch (emergencyError) {
          console.error(`❌ [InspectionService] Emergency save also failed for ${inspectionId}:`, {
            error: emergencyError.message
          });
        }
      }

      // 배치 진행률 업데이트
      const batchId = inspectionConfig.batchId || inspectionId;
      const batchProgress = this.calculateBatchProgress(batchId);

      webSocketService.broadcastProgressUpdate(batchId, {
        status: 'IN_PROGRESS',
        progress: {
          percentage: batchProgress.percentage,
          completedItems: batchProgress.completedItems,
          totalItems: batchProgress.totalItems,
          currentStep: `Completed ${inspectionConfig.targetItemId}`,
          estimatedTimeRemaining: batchProgress.estimatedTimeRemaining
        },
        completedItem: {
          inspectionId,
          itemId: inspectionConfig.targetItemId,
          saveSuccessful,
          completedAt: Date.now()
        },
        batchInfo: {
          batchId,
          totalInspections: batchProgress.totalItems,
          completedInspections: batchProgress.completedItems,
          remainingInspections: batchProgress.totalItems - batchProgress.completedItems
        }
      });

      webSocketService.broadcastStatusChange(batchId, {
        status: 'IN_PROGRESS',
        message: `Completed ${inspectionConfig.targetItemId} (${batchProgress.completedItems}/${batchProgress.totalItems})`,
        progress: batchProgress.percentage,
        completedItem: {
          inspectionId,
          itemId: inspectionConfig.targetItemId,
          saveSuccessful,
          completedAt: Date.now()
        },
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.error('Item inspection execution failed', {
        inspectionId,
        customerId,
        serviceType,
        itemId: inspectionConfig.targetItemId,
        error: error.message,
        stack: error.stack
      });

      await this.handlePartialInspectionFailure(
        customerId,
        inspectionId,
        serviceType,
        error,
        inspector
      );

      inspectionStatus.fail(error.message);

      const batchId = inspectionConfig.batchId || inspectionId;
      const isBatchInspection = inspectionConfig.batchId && inspectionConfig.batchId !== inspectionId;

      if (isBatchInspection) {
        webSocketService.broadcastStatusChange(batchId, {
          status: 'ITEM_FAILED',
          error: error.message,
          failedAt: Date.now(),
          failedItem: {
            inspectionId,
            itemId: inspectionConfig.targetItemId,
            error: error.message
          },
          partialResults: inspector?.getPartialResults?.() || null
        });
      } else {
        webSocketService.broadcastStatusChange(inspectionId, {
          status: 'FAILED',
          error: error.message,
          failedAt: Date.now(),
          itemId: inspectionConfig.targetItemId,
          partialResults: inspector?.getPartialResults?.() || null
        });
      }
    }
  }

  /**
   * Assume Role 수행
   * @param {string} roleArn - 역할 ARN
   * @param {string} inspectionId - 검사 ID
   * @returns {Promise<Object>} AWS 자격 증명
   */
  async assumeRole(roleArn, inspectionId) {
    try {
      this.initializeStsClient();

      const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `inspection-${inspectionId}`,
        DurationSeconds: 3600,
        ExternalId: process.env.AWS_EXTERNAL_ID
      });

      const response = await this.stsClient.send(command);

      if (!response.Credentials) {
        throw new Error('No credentials returned from assume role operation');
      }

      return {
        accessKeyId: response.Credentials.AccessKeyId,
        secretAccessKey: response.Credentials.SecretAccessKey,
        sessionToken: response.Credentials.SessionToken,
        expiration: response.Credentials.Expiration,
        roleArn: roleArn,
        region: process.env.AWS_REGION || 'us-east-1'
      };

    } catch (error) {
      this.logger.error('Failed to assume role', {
        roleArn,
        inspectionId,
        error: error.message
      });

      if (error.name === 'AccessDenied') {
        throw new Error(`Access denied when assuming role ${roleArn}. Please check role permissions and trust policy.`);
      } else if (error.name === 'InvalidParameterValue') {
        throw new Error(`Invalid role ARN: ${roleArn}`);
      } else {
        throw new Error(`Failed to assume role: ${error.message}`);
      }
    }
  }

  /**
   * 검사 상태 조회
   * @param {string} inspectionId - 검사 ID
   * @param {string} customerId - 고객 ID
   * @returns {Object} 검사 상태 정보
   */
  getInspectionStatus(inspectionId, customerId) {
    const inspectionStatus = this.activeInspections.get(inspectionId);

    if (!inspectionStatus) {
      return {
        success: false,
        error: {
          code: 'INSPECTION_NOT_FOUND',
          message: 'Inspection not found or has been completed'
        }
      };
    }

    return {
      success: true,
      inspectionId,
      status: inspectionStatus.status,
      progress: inspectionStatus.progress,
      estimatedTimeRemaining: inspectionStatus.estimatedTimeRemaining,
      currentStep: inspectionStatus.currentStep,
      startTime: inspectionStatus.startTime,
      lastUpdated: inspectionStatus.lastUpdated
    };
  }

  /**
   * 검사 결과 조회
   * @param {string} inspectionId - 검사 ID
   * @param {string} customerId - 고객 ID
   * @returns {Promise<Object>} 검사 결과
   */
  async getInspectionResult(inspectionId, customerId) {
    try {
      const historyService = require('./historyService');
      const historyResult = await historyService.getInspectionHistory(customerId, inspectionId);

      if (!historyResult.success) {
        return {
          success: false,
          error: {
            code: 'INSPECTION_NOT_FOUND',
            message: 'Inspection not found',
            details: 'The requested inspection could not be found or you do not have access to it'
          }
        };
      }

      return {
        success: true,
        inspection: historyResult.data
      };

    } catch (error) {
      this.logger.error('Failed to get inspection result', {
        inspectionId,
        customerId,
        error: error.message
      });

      return {
        success: false,
        error: {
          code: 'INSPECTION_RETRIEVAL_FAILED',
          message: 'Failed to retrieve inspection result',
          details: error.message
        }
      };
    }
  }

  // ========== 헬퍼 메서드들 ==========

  /**
   * STS 클라이언트 초기화
   */
  initializeStsClient() {
    if (!this.stsClient) {
      this.stsClient = new STSClient({
        region: process.env.AWS_REGION || 'us-east-1'
      });
    }
  }

  /**
   * 배치 진행률 계산
   */
  calculateBatchProgress(batchId) {
    const batchInfo = this.activeBatches.get(batchId);

    if (!batchInfo) {
      return {
        percentage: 0,
        completedItems: 0,
        totalItems: 0,
        estimatedTimeRemaining: null
      };
    }

    const completedItems = batchInfo.inspectionIds.filter(inspectionId => {
      const inspection = this.activeInspections.get(inspectionId);
      return inspection && (inspection.status === 'COMPLETED' || inspection.status === 'FAILED');
    }).length;

    const totalItems = batchInfo.totalItems;
    const percentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    let estimatedTimeRemaining = null;
    if (completedItems > 0 && completedItems < totalItems) {
      const elapsedTime = Date.now() - batchInfo.startTime;
      const averageTimePerItem = elapsedTime / completedItems;
      const remainingItems = totalItems - completedItems;
      estimatedTimeRemaining = Math.round(averageTimePerItem * remainingItems / 1000);
    }

    return {
      percentage,
      completedItems,
      totalItems,
      estimatedTimeRemaining
    };
  }

  /**
   * 배치 완료 알림 전송
   */
  broadcastBatchCompletion(batchId, inspectionJobs, error = null) {
    const completionData = {
      status: error ? 'FAILED' : 'COMPLETED',
      batchId,
      totalInspections: inspectionJobs.length,
      completedInspections: error ? 0 : inspectionJobs.length,
      inspectionJobs: inspectionJobs.map(job => ({
        inspectionId: job.inspectionId,
        itemId: job.itemId,
        status: error ? 'FAILED' : 'COMPLETED'
      })),
      completedAt: Date.now(),
      duration: Date.now() - (this.activeInspections.get(inspectionJobs[0]?.inspectionId)?.startTime || Date.now()),
      saveSuccessful: !error,
      forceRefresh: true,
      refreshCommand: 'RELOAD_ALL_DATA',
      cacheBreaker: Date.now()
    };

    if (error) {
      completionData.error = error.message;
    }

    webSocketService.broadcastProgressUpdate(batchId, {
      status: error ? 'FAILED' : 'COMPLETED',
      progress: {
        percentage: 100,
        completedItems: inspectionJobs.length,
        totalItems: inspectionJobs.length,
        currentStep: error ? 'Batch failed' : 'All inspections completed',
        estimatedTimeRemaining: 0
      },
      batchInfo: {
        batchId,
        totalInspections: inspectionJobs.length,
        completedInspections: inspectionJobs.length,
        remainingInspections: 0
      }
    });

    webSocketService.broadcastInspectionComplete(batchId, completionData);
  }

  /**
   * 항목명 가져오기 (더 이상 사용하지 않음 - 프론트엔드에서 매핑)
   */
  getItemName(serviceType, itemId) {
    // 프론트엔드에서 매핑하므로 itemId 그대로 반환
    return itemId;
  }

  /**
   * 검사 진행률 업데이트
   */
  updateInspectionProgress(inspectionId, steps, currentStepIndex, additionalData = {}) {
    const inspectionStatus = this.activeInspections.get(inspectionId);
    if (!inspectionStatus) return;

    const currentStep = steps[currentStepIndex];
    const completedWeight = steps.slice(0, currentStepIndex).reduce((sum, step) => sum + step.weight, 0);
    const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);

    let stepProgress = 0;
    if (additionalData.stepProgress && currentStepIndex < steps.length) {
      stepProgress = (currentStep.weight * additionalData.stepProgress) / 100;
    }

    const percentage = Math.round(((completedWeight + stepProgress) / totalWeight) * 100);

    inspectionStatus.updateProgress({
      percentage,
      currentStep: currentStep.name,
      estimatedTimeRemaining: inspectionStatus.calculateEstimatedTimeRemaining?.(percentage) || null
    });

    // WebSocket으로 진행률 전송
    webSocketService.broadcastProgressUpdate(inspectionId, {
      status: 'IN_PROGRESS',
      progress: {
        percentage,
        currentStep: currentStep.name,
        estimatedTimeRemaining: inspectionStatus.estimatedTimeRemaining
      }
    });
  }

  /**
   * Inspector 진행률과 동기화
   */
  syncInspectionProgress(inspectionId, inspector, steps, currentStepIndex) {
    if (inspector && inspector.getProgress) {
      const inspectorProgress = inspector.getProgress();
      this.updateInspectionProgress(inspectionId, steps, currentStepIndex, {
        stepProgress: inspectorProgress.percentage
      });
    }
  }

  /**
   * 검사 시작 상태 저장
   */
  async saveInspectionStart(customerId, inspectionId, serviceType, assumeRoleArn, metadata) {
    try {
      // 검사 시작 로그만 기록 (실제 구현에서는 필요에 따라 DB 저장)
      this.logger.info('Inspection started', {
        customerId,
        inspectionId,
        serviceType,
        assumeRoleArn,
        metadata
      });
    } catch (error) {
      this.logger.error('Failed to save inspection start', {
        inspectionId,
        error: error.message
      });
    }
  }

  /**
   * 트랜잭션을 사용한 검사 결과 저장
   */
  async saveInspectionResultWithTransaction(inspectionResult) {
    try {
      const transactionService = require('./transactionService');
      const result = await transactionService.saveInspectionResultsTransaction(
        inspectionResult,
        inspectionResult.itemResults || []
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Transaction failed');
      }

      return result;
    } catch (error) {
      this.logger.error('Transaction save failed', {
        inspectionId: inspectionResult.inspectionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 응급 저장 (트랜잭션 실패 시)
   */
  async emergencySaveInspectionResult(inspectionResult) {
    try {
      const inspectionItemService = require('./inspectionItemService');
      
      if (inspectionResult.itemResults && inspectionResult.itemResults.length > 0) {
        for (const itemResult of inspectionResult.itemResults) {
          await inspectionItemService.saveInspectionItemResult(itemResult, inspectionResult.inspectionId);
        }
      }

      this.logger.info('Emergency save completed', {
        inspectionId: inspectionResult.inspectionId,
        itemCount: inspectionResult.itemResults?.length || 0
      });
    } catch (error) {
      this.logger.error('Emergency save failed', {
        inspectionId: inspectionResult.inspectionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 부분적 검사 실패 처리
   */
  async handlePartialInspectionFailure(customerId, inspectionId, serviceType, error, inspector) {
    try {
      if (inspector && inspector.getPartialResults) {
        const partialResults = inspector.getPartialResults();
        if (partialResults && partialResults.length > 0) {
          await this.emergencySaveInspectionResult({
            inspectionId,
            customerId,
            serviceType,
            itemResults: partialResults
          });
        }
      }
    } catch (saveError) {
      this.logger.error('Failed to save partial results', {
        inspectionId,
        error: saveError.message
      });
    }
  }

  /**
   * 로거 생성
   */
  createLogger() {
    return {
      info: (message, meta = {}) => {
        console.log(`[INFO] [InspectionService] ${message}`, meta);
      },
      error: (message, meta = {}) => {
        console.error(`[ERROR] [InspectionService] ${message}`, meta);
      }
    };
  }
}

module.exports = new InspectionService();