const BaseInspector = require('../baseInspector');
const PublicAccessInspector = require('./checks/publicAccessInspector');

class S3Inspector extends BaseInspector {
  constructor() {
    super('S3');
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
    
    this.handleUnknownInspectionItem(targetItem);
  }

  async performAllInspections(awsCredentials, inspectionConfig) {
    const inspectors = [
      new PublicAccessInspector()
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
      resourcesScanned: this.resourcesScanned
    }];
  }
}

module.exports = S3Inspector;