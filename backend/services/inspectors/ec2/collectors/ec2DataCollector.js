/**
 * EC2 Data Collector
 * EC2 관련 데이터 수집을 담당하는 모듈
 */

const { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeSnapshotsCommand, DescribeSubnetsCommand, DescribeReservedInstancesCommand } = require('@aws-sdk/client-ec2');

class EC2DataCollector {
  constructor(ec2Client, inspector) {
    this.ec2Client = ec2Client;
    this.inspector = inspector;
  }

  /**
   * 모든 EC2 관련 데이터 수집
   */
  async collectAllData() {
    const [securityGroups, instances] = await Promise.all([
      this.getSecurityGroups(),
      this.getEC2Instances()
    ]);

    return {
      securityGroups,
      instances
    };
  }

  /**
   * 보안 그룹 목록 조회
   */
  async getSecurityGroups() {
    try {
      const command = new DescribeSecurityGroupsCommand({});
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeSecurityGroups'
      );

      return response.SecurityGroups || [];
    } catch (error) {
      this.inspector.recordError(error, { operation: 'getSecurityGroups' });
      throw error;
    }
  }

  /**
   * EC2 인스턴스 목록 조회
   */
  async getEC2Instances() {
    try {
      const command = new DescribeInstancesCommand({});
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeInstances'
      );

      const instances = [];
      if (response.Reservations) {
        response.Reservations.forEach(reservation => {
          if (reservation.Instances) {
            instances.push(...reservation.Instances);
          }
        });
      }

      return instances;
    } catch (error) {
      this.inspector.recordError(error, { operation: 'getEC2Instances' });
      throw error;
    }
  }

  /**
   * 특정 보안 그룹 조회
   */
  async getSecurityGroup(groupId) {
    try {
      const command = new DescribeSecurityGroupsCommand({
        GroupIds: [groupId]
      });
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeSecurityGroups'
      );

      return response.SecurityGroups?.[0] || null;
    } catch (error) {
      this.inspector.recordError(error, { 
        operation: 'getSecurityGroup',
        groupId 
      });
      return null;
    }
  }

  /**
   * 특정 인스턴스 조회
   */
  async getInstance(instanceId) {
    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId]
      });
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeInstances'
      );

      if (response.Reservations?.[0]?.Instances) {
        return response.Reservations[0].Instances[0];
      }
      return null;
    } catch (error) {
      this.inspector.recordError(error, { 
        operation: 'getInstance',
        instanceId 
      });
      return null;
    }
  }

  /**
   * 활성 인스턴스만 필터링
   */
  getActiveInstances(instances) {
    return instances.filter(instance => 
      instance.State?.Name !== 'terminated' && 
      instance.State?.Name !== 'terminating'
    );
  }

  /**
   * EBS 스냅샷 목록 조회
   */
  async getSnapshots(ownerId = 'self') {
    try {
      const command = new DescribeSnapshotsCommand({
        OwnerIds: [ownerId]
      });
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeSnapshots'
      );

      return response.Snapshots || [];
    } catch (error) {
      this.inspector.recordError(error, { operation: 'getSnapshots' });
      throw error;
    }
  }

  /**
   * 특정 볼륨의 스냅샷 조회
   */
  async getSnapshotsForVolume(volumeId) {
    try {
      const command = new DescribeSnapshotsCommand({
        OwnerIds: ['self'],
        Filters: [
          {
            Name: 'volume-id',
            Values: [volumeId]
          }
        ]
      });
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeSnapshots'
      );

      return response.Snapshots || [];
    } catch (error) {
      this.inspector.recordError(error, { 
        operation: 'getSnapshotsForVolume',
        volumeId 
      });
      return [];
    }
  }

  /**
   * 서브넷 정보 조회
   */
  async getSubnets(subnetIds = null) {
    try {
      const params = {};
      if (subnetIds && subnetIds.length > 0) {
        params.SubnetIds = subnetIds;
      }
      
      const command = new DescribeSubnetsCommand(params);
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeSubnets'
      );

      return response.Subnets || [];
    } catch (error) {
      this.inspector.recordError(error, { 
        operation: 'getSubnets',
        subnetIds 
      });
      return [];
    }
  }

  /**
   * 예약 인스턴스 목록 조회
   */
  async getReservedInstances() {
    try {
      const command = new DescribeReservedInstancesCommand({});
      const response = await this.inspector.retryableApiCall(
        () => this.ec2Client.send(command),
        'DescribeReservedInstances'
      );

      return response.ReservedInstances || [];
    } catch (error) {
      this.inspector.recordError(error, { operation: 'getReservedInstances' });
      throw error;
    }
  }



  /**
   * 보안 그룹 사용 현황 분석 (필요시에만 실행)
   */
  analyzeSecurityGroupUsage(instances, securityGroups, analysisType = 'full') {
    const usedSecurityGroupIds = new Set();
    
    // 인스턴스에서 사용되는 보안 그룹 수집
    instances.forEach(instance => {
      if (instance.SecurityGroups) {
        instance.SecurityGroups.forEach(sg => {
          usedSecurityGroupIds.add(sg.GroupId);
        });
      }
    });

    const result = { usedSecurityGroupIds };
    
    // 전체 분석이 필요한 경우에만 추가 계산
    if (analysisType === 'full') {
      const securityGroupUsage = new Map();
      
      instances.forEach(instance => {
        if (instance.SecurityGroups) {
          instance.SecurityGroups.forEach(sg => {
            if (!securityGroupUsage.has(sg.GroupId)) {
              securityGroupUsage.set(sg.GroupId, []);
            }
            securityGroupUsage.get(sg.GroupId).push(instance.InstanceId);
          });
        }
      });
      
      const unusedSecurityGroups = securityGroups.filter(sg => 
        !usedSecurityGroupIds.has(sg.GroupId) && sg.GroupName !== 'default'
      );
      
      result.securityGroupUsage = securityGroupUsage;
      result.unusedSecurityGroups = unusedSecurityGroups;
    }

    return result;
  }
}

module.exports = EC2DataCollector;