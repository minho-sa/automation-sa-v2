const BaseInspector = require('../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('./collectors/ec2DataCollector');
const SecurityGroupInspector = require('./checks/securityGroupInspector');
const BackupStatusInspector = require('./checks/backupStatusInspector');
const WindowsServerEolInspector = require('./checks/windowsServerEolInspector');
const PublicInstanceInspector = require('./checks/publicInstanceInspector');
const InstanceTypeOptimizationInspector = require('./checks/instanceTypeOptimizationInspector');
const ReservedInstanceInspector = require('./checks/reservedInstanceInspector');
const StoppedInstanceInspector = require('./checks/stoppedInstanceInspector');

class EC2Inspector extends BaseInspector {
  constructor() {
    super('EC2');
  }

  async preInspectionValidation(awsCredentials, inspectionConfig) {
    const region = inspectionConfig.region || awsCredentials.region || 'us-east-1';
    this.region = region;
    
    this.ec2Client = new EC2Client({
      region: region,
      credentials: {
        accessKeyId: awsCredentials.accessKeyId,
        secretAccessKey: awsCredentials.secretAccessKey,
        sessionToken: awsCredentials.sessionToken
      }
    });
    this.dataCollector = new EC2DataCollector(this.ec2Client, this);
    
    this.logger.info(`EC2 inspection initialized for region: ${region}`);
  }

  async performItemInspection(awsCredentials, inspectionConfig) {
    const targetItem = inspectionConfig.targetItem || inspectionConfig.targetItemId;
    
    if (targetItem === 'all') {
      return await this.performInspection(awsCredentials, inspectionConfig);
    }
    
    const inspectorMap = {
      'security-groups': SecurityGroupInspector,
      'backup-status': BackupStatusInspector,
      'windows-server-eol': WindowsServerEolInspector,
      'public-instances': PublicInstanceInspector,
      'instance-type-optimization': InstanceTypeOptimizationInspector,
      'reserved-instances': ReservedInstanceInspector,
      'stopped-instances': StoppedInstanceInspector
    };
    
    const InspectorClass = inspectorMap[targetItem];
    if (InspectorClass) {
      await this.executeInspector(InspectorClass, awsCredentials, inspectionConfig, targetItem);
      return;
    }
    
    this.handleUnknownInspectionItem(targetItem);
  }

  async executeInspector(InspectorClass, awsCredentials, inspectionConfig, targetItem) {
    try {
      const inspector = new InspectorClass();
      await inspector.executeInspection(awsCredentials, inspectionConfig);
      this.findings.push(...inspector.findings);
      this.incrementResourceCount(inspector.resourcesScanned);
    } catch (error) {
      this.recordError(error, { targetItem });
      throw error;
    }
  }

  async performInspection(awsCredentials, inspectionConfig) {
    const data = await this.dataCollector.collectAllData();
    this.incrementResourceCount(data.securityGroups.length + data.instances.length);
    
    if (data.securityGroups.length > 0) {
      await this.executeInspector(SecurityGroupInspector, awsCredentials, inspectionConfig);
    }
    
    if (data.instances.length > 0) {
      await this.executeInspector(BackupStatusInspector, awsCredentials, inspectionConfig);
      await this.executeInspector(WindowsServerEolInspector, awsCredentials, inspectionConfig);
      await this.executeInspector(PublicInstanceInspector, awsCredentials, inspectionConfig);
      await this.executeInspector(InstanceTypeOptimizationInspector, awsCredentials, inspectionConfig);
      await this.executeInspector(ReservedInstanceInspector, awsCredentials, inspectionConfig);
      await this.executeInspector(StoppedInstanceInspector, awsCredentials, inspectionConfig);
    }
  }
}

module.exports = EC2Inspector;