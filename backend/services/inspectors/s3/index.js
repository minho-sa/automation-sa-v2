const BaseInspector = require('../baseInspector');
const PublicAccessInspector = require('./checks/publicAccessInspector');
const EncryptionInspector = require('./checks/encryptionInspector');

class S3Inspector extends BaseInspector {
  constructor() {
    super('S3');
  }

  async preInspectionValidation(awsCredentials, inspectionConfig) {
    const region = inspectionConfig.region || awsCredentials.region || 'us-east-1';
    this.region = region;
    this.logger.info(`S3 inspection initialized for region: ${region}`);
  }

  async performInspection(awsCredentials, inspectionConfig) {
    const targetItem = inspectionConfig.targetItem || inspectionConfig.targetItemId;
    
    if (targetItem === 'all') {
      await this.performAllInspections(awsCredentials, inspectionConfig);
      return;
    }
    
    if (targetItem === 'public-access') {
      const inspector = new PublicAccessInspector();
      await inspector.executeInspection(awsCredentials, inspectionConfig);
      this.findings.push(...inspector.findings);
      this.incrementResourceCount(inspector.resourcesScanned);
      return;
    }
    
    if (targetItem === 'encryption-settings') {
      const inspector = new EncryptionInspector();
      await inspector.executeInspection(awsCredentials, inspectionConfig);
      this.findings.push(...inspector.findings);
      this.incrementResourceCount(inspector.resourcesScanned);
      return;
    }
    
    this.handleUnknownInspectionItem(targetItem);
  }

  async performAllInspections(awsCredentials, inspectionConfig) {
    const inspectors = [
      new PublicAccessInspector(),
      new EncryptionInspector()
    ];
    
    for (const inspector of inspectors) {
      try {
        await inspector.executeInspection(awsCredentials, inspectionConfig);
        this.findings.push(...inspector.findings);
        this.incrementResourceCount(inspector.resourcesScanned);
      } catch (error) {
        this.recordError(error, { context: `${inspector.constructor.name} 실행` });
      }
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'default',
      findings: this.findings.map(f => f.toApiResponse()),
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned,
      region: this.region
    }];
  }
}

module.exports = S3Inspector;