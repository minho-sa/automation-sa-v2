const {
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { dynamoDBDocClient } = require('../config/aws');

const { User } = require('../models');
const { v4: uuidv4 } = require('uuid');

/**
 * 통합 DynamoDB 서비스
 * 모든 DynamoDB 작업을 통합 관리 (비즈니스 로직 포함)
 */
class DynamoService {
  constructor() {
    this.client = dynamoDBDocClient;
    this.tables = {
      USERS: process.env.AWS_DYNAMODB_TABLE || 'aws_v2',
      INSPECTION_ITEMS: process.env.AWS_DYNAMODB_INSPECTION_ITEMS_TABLE || 'InspectionItemResults'
    };
  }

  // ========== 사용자 관련 작업 ==========
  
  async createUser(userData) {
    try {
      // 모델을 사용한 데이터 검증
      const validation = User.helpers.validateUserData(userData);
      if (!validation.isValid) {
        throw User.helpers.createError(
          `입력 데이터 오류: ${validation.errors.join(', ')}`,
          User.ERROR_CODES.VALIDATION_ERROR
        );
      }

      const userId = uuidv4();
      const userRecord = {
        userId,
        ...User.helpers.createUserData(userData)
      };

      const command = new PutCommand({
        TableName: this.tables.USERS,
        Item: userRecord,
        ConditionExpression: 'attribute_not_exists(userId)'
      });
      
      await this.client.send(command);

      return {
        success: true,
        userId,
        user: userRecord,
      };
    } catch (error) {
      if (error.code === User.ERROR_CODES.VALIDATION_ERROR) {
        throw error;
      }
      if (error.name === 'ConditionalCheckFailedException') {
        throw User.helpers.createError(
          '사용자가 이미 존재합니다',
          User.ERROR_CODES.DUPLICATE_USER
        );
      }
      throw User.helpers.createError(
        `사용자 생성 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async getUserById(userId) {
    try {
      // 모델을 사용한 사용자 ID 검증
      const userIdValidation = User.helpers.validateUserId(userId);
      if (!userIdValidation.isValid) {
        throw User.helpers.createError(
          userIdValidation.error,
          User.ERROR_CODES.MISSING_PARAMETER
        );
      }

      const command = new GetCommand({
        TableName: this.tables.USERS,
        Key: { userId }
      });
      
      const result = await this.client.send(command);

      if (!result.Item) {
        throw User.helpers.createError(
          '사용자를 찾을 수 없습니다',
          User.ERROR_CODES.USER_NOT_FOUND
        );
      }

      return {
        success: true,
        user: result.Item,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      throw User.helpers.createError(
        `사용자 조회 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async getUserByUsername(username) {
    try {
      const command = new QueryCommand({
        TableName: this.tables.USERS,
        IndexName: 'username-index',
        KeyConditionExpression: 'username = :username',
        ExpressionAttributeValues: { ':username': username }
      });
      
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        return { success: false, error: '사용자를 찾을 수 없습니다' };
      }

      return {
        success: true,
        user: result.Items[0],
      };
    } catch (error) {
      throw User.helpers.createError(
        `사용자 조회 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async updateUserStatus(userId, status) {
    try {
      // 모델을 사용한 사용자 ID 검증
      const userIdValidation = User.helpers.validateUserId(userId);
      if (!userIdValidation.isValid) {
        throw User.helpers.createError(
          userIdValidation.error,
          User.ERROR_CODES.MISSING_PARAMETER
        );
      }

      // 모델을 사용한 상태 검증
      if (!User.helpers.validateStatus(status)) {
        throw User.helpers.createError(
          `유효하지 않은 상태: ${status}. 가능한 값: ${Object.values(User.STATUS).join(', ')}`,
          User.ERROR_CODES.INVALID_STATUS
        );
      }

      const updateData = User.helpers.createUpdateData({ status });

      const command = new UpdateCommand({
        TableName: this.tables.USERS,
        Key: { userId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': updateData.status,
          ':updatedAt': updateData.updatedAt
        },
        ConditionExpression: 'attribute_exists(userId)',
        ReturnValues: 'ALL_NEW'
      });
      
      const result = await this.client.send(command);

      return {
        success: true,
        user: result.Attributes,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      if (error.name === 'ConditionalCheckFailedException') {
        throw User.helpers.createError(
          '사용자를 찾을 수 없습니다',
          User.ERROR_CODES.USER_NOT_FOUND
        );
      }
      throw User.helpers.createError(
        `사용자 상태 업데이트 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async updateArnValidation(userId, isValid, error = null) {
    try {
      const arnValidation = User.helpers.createArnValidation(isValid, error);
      const updateData = User.helpers.createUpdateData({ arnValidation });

      const command = new UpdateCommand({
        TableName: this.tables.USERS,
        Key: { userId },
        UpdateExpression: 'SET arnValidation = :arnValidation, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':arnValidation': updateData.arnValidation,
          ':updatedAt': updateData.updatedAt
        },
        ConditionExpression: 'attribute_exists(userId)',
        ReturnValues: 'ALL_NEW'
      });
      
      const result = await this.client.send(command);

      return {
        success: true,
        user: result.Attributes,
      };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw User.helpers.createError(
          '사용자를 찾을 수 없습니다',
          User.ERROR_CODES.USER_NOT_FOUND
        );
      }
      throw User.helpers.createError(
        `ARN 검증 결과 업데이트 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async updateUserTimestamp(userId) {
    try {
      const timestampData = User.helpers.createTimestampUpdate();
      
      const command = new UpdateCommand({
        TableName: this.tables.USERS,
        Key: { userId },
        UpdateExpression: 'SET updatedAt = :timestamp',
        ExpressionAttributeValues: {
          ':timestamp': timestampData.updatedAt
        },
        ConditionExpression: 'attribute_exists(userId)'
      });
      
      await this.client.send(command);
      return { success: true };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw User.helpers.createError(
          '사용자를 찾을 수 없습니다',
          User.ERROR_CODES.USER_NOT_FOUND
        );
      }
      throw User.helpers.createError(
        `사용자 타임스탬프 업데이트 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  async getAllUsers() {
    try {
      const command = new ScanCommand({
        TableName: this.tables.USERS
      });
      
      const result = await this.client.send(command);

      return {
        success: true,
        users: result.Items || [],
        count: result.Count || 0,
      };
    } catch (error) {
      throw User.helpers.createError(
        `사용자 목록 조회 실패: ${error.message}`,
        User.ERROR_CODES.DATABASE_ERROR,
        error
      );
    }
  }

  // ========== 검사 결과 관련 작업 ==========

  async saveInspectionItem(itemData) {
    const command = new PutCommand({
      TableName: this.tables.INSPECTION_ITEMS,
      Item: itemData
    });
    return await this.client.send(command);
  }

  async getInspectionHistory(customerId, options = {}) {
    const { historyMode = 'history', serviceType, region, lastEvaluatedKey, limit = 10 } = options;
    
    console.log(`📊 [DynamoService] Query params:`, { customerId, historyMode, serviceType, region });
    
    let keyConditionExpression = 'customerId = :customerId';
    let expressionAttributeValues = { ':customerId': customerId };
    
    // 리전별 최적화된 필터링
    if (serviceType && serviceType !== 'all' && region) {
      // 서비스+리전: LATEST#EC2#us-east-1# 또는 HISTORY#EC2#us-east-1#
      const keyPrefix = historyMode === 'latest' 
        ? `LATEST#${serviceType}#${region}#`
        : `HISTORY#${serviceType}#${region}#`;
      keyConditionExpression += ' AND begins_with(itemKey, :prefix)';
      expressionAttributeValues[':prefix'] = keyPrefix;
      console.log(`🎯 [DynamoService] Using region-specific prefix: ${keyPrefix}`);
    } else if (serviceType && serviceType !== 'all') {
      // 서비스만: LATEST#EC2# 또는 HISTORY#EC2#
      const keyPrefix = historyMode === 'latest' 
        ? `LATEST#${serviceType}#`
        : `HISTORY#${serviceType}#`;
      keyConditionExpression += ' AND begins_with(itemKey, :prefix)';
      expressionAttributeValues[':prefix'] = keyPrefix;
      console.log(`🛠️ [DynamoService] Using service prefix: ${keyPrefix}`);
    } else {
      // 전체: LATEST# 또는 HISTORY#
      const keyPrefix = historyMode === 'latest' ? 'LATEST#' : 'HISTORY#';
      keyConditionExpression += ' AND begins_with(itemKey, :prefix)';
      expressionAttributeValues[':prefix'] = keyPrefix;
      console.log(`🌍 [DynamoService] Using global prefix: ${keyPrefix}`);
    }

    const params = {
      TableName: this.tables.INSPECTION_ITEMS,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      Limit: limit
    };

    if (lastEvaluatedKey) {
      try {
        params.ExclusiveStartKey = typeof lastEvaluatedKey === 'string'
          ? JSON.parse(lastEvaluatedKey)
          : lastEvaluatedKey;
      } catch (parseError) {
        console.warn('Invalid lastEvaluatedKey format:', parseError.message);
      }
    }

    if (historyMode === 'latest') {
      params.ConsistentRead = true;
    }

    const command = new QueryCommand(params);
    const result = await this.client.send(command);
    
    console.log(`📊 [DynamoService] Query result:`, {
      itemCount: result.Items?.length || 0,
      scannedCount: result.ScannedCount || 0,
      hasMore: !!result.LastEvaluatedKey
    });
    
    return result;
  }

  // ========== 범용 DynamoDB 작업 ==========

  async batchWrite(tableName, items) {
    // 배치 쓰기 구현
    const chunks = this.chunkArray(items, 25); // DynamoDB 배치 제한
    const results = [];

    for (const chunk of chunks) {
      const command = new PutCommand({
        TableName: tableName,
        Item: chunk
      });
      results.push(await this.client.send(command));
    }

    return results;
  }

  async query(tableName, keyCondition, options = {}) {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyCondition.expression,
      ExpressionAttributeValues: keyCondition.values,
      ...options
    });
    return await this.client.send(command);
  }

  async scan(tableName, options = {}) {
    const command = new ScanCommand({
      TableName: tableName,
      ...options
    });
    return await this.client.send(command);
  }

  // ========== 헬퍼 메서드 ==========

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  getTableName(tableType) {
    return this.tables[tableType] || tableType;
  }
}

module.exports = new DynamoService();