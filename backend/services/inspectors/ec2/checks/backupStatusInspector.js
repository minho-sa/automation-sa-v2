const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class BackupStatusInspector extends BaseInspector {
  constructor() {
    super('EC2');
    this.BACKUP_THRESHOLD_DAYS = 7;
  }

  async retryableApiCall(apiCall, operationName, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async performInspection(awsCredentials, inspectionConfig) {
    try {
      this.ec2Client = new EC2Client({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      this.dataCollector = new EC2DataCollector(this.ec2Client, this);

      const instances = await this.dataCollector.getEC2Instances();
      const snapshots = await this.dataCollector.getSnapshots();
      
      if (!Array.isArray(instances)) {
        this.addFinding('instances', 'EC2Instance', '인스턴스 데이터 형식 오류', '데이터 구조 확인');
        throw new Error('인스턴스 데이터 형식 오류');
      }
      if (!Array.isArray(snapshots)) {
        this.addFinding('snapshots', 'EBSSnapshot', '스냅샷 데이터 형식 오류', '데이터 구조 확인');
        throw new Error('스냅샷 데이터 형식 오류');
      }
      
      await this.checkInstanceBackupStatus(instances, snapshots);

    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'backup-status',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkInstanceBackupStatus(instances, snapshots) {
    const activeInstances = this.dataCollector.getActiveInstances(instances);
    let hasFormatError = false;
    const formatErrors = new Set();
    
    for (const instance of activeInstances) {
      this.incrementResourceCount();
      
      const validation = this.validateInstanceFormat(instance);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      await this.checkInstanceBackup(instance, snapshots);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  validateInstanceFormat(instance) {
    if (!instance || typeof instance !== 'object') {
      return { valid: false, error: '인스턴스가 객체가 아님' };
    }
    
    if (!instance.InstanceId) {
      return { valid: false, error: 'InstanceId 누락' };
    }
    
    if (!instance.BlockDeviceMappings || !Array.isArray(instance.BlockDeviceMappings)) {
      return { valid: false, error: 'BlockDeviceMappings 누락 또는 배열이 아님' };
    }
    
    return { valid: true };
  }

  async checkInstanceBackup(instance, snapshots) {
    const instanceId = instance.InstanceId;
    const instanceName = this.getInstanceName(instance);
    const volumeIds = this.getInstanceVolumeIds(instance);
    
    if (volumeIds.length === 0) {
      this.addFinding(
        instanceId,
        'EC2Instance',
        `인스턴스 ${instanceName}에 연결된 EBS 볼륨이 없습니다`,
        'EBS 볼륨 연결 상태를 확인하세요'
      );
      return;
    }

    const recentBackups = this.findRecentBackups(volumeIds, snapshots);
    const volumesWithoutBackup = volumeIds.filter(volumeId => 
      !recentBackups.some(backup => backup.VolumeId === volumeId)
    );

    if (volumesWithoutBackup.length > 0) {
      this.addFinding(
        instanceId,
        'EC2Instance',
        `인스턴스 ${instanceName}의 ${volumesWithoutBackup.length}개 볼륨이 최근 ${this.BACKUP_THRESHOLD_DAYS}일 내 백업이 없습니다`,
        `정기적인 백업 정책을 수립하고 AWS Backup 또는 스냅샷 스케줄링을 설정하세요. 볼륨 ID: ${volumesWithoutBackup.join(', ')}`
      );
    }
  }

  getInstanceName(instance) {
    const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
    return nameTag ? nameTag.Value : instance.InstanceId;
  }

  getInstanceVolumeIds(instance) {
    const volumeIds = [];
    if (instance.BlockDeviceMappings) {
      for (const mapping of instance.BlockDeviceMappings) {
        if (mapping.Ebs?.VolumeId) {
          volumeIds.push(mapping.Ebs.VolumeId);
        }
      }
    }
    return volumeIds;
  }

  findRecentBackups(volumeIds, snapshots) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - this.BACKUP_THRESHOLD_DAYS);
    
    return snapshots.filter(snapshot => {
      if (!volumeIds.includes(snapshot.VolumeId)) return false;
      if (!snapshot.StartTime) return false;
      
      const snapshotDate = new Date(snapshot.StartTime);
      return snapshotDate >= thresholdDate;
    });
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding('system', 'Permission', 'AWS 권한 부족', 'EC2 및 EBS 스냅샷 조회 권한 확인');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS API 호출' });
    }
  }
}

module.exports = BackupStatusInspector;