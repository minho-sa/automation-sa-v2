import React from 'react';
import './RegionSelector.css';

const AWS_REGIONS = [
  { code: 'us-east-1', name: 'US East (N. Virginia)' },
  { code: 'us-east-2', name: 'US East (Ohio)' },
  { code: 'us-west-1', name: 'US West (N. California)' },
  { code: 'us-west-2', name: 'US West (Oregon)' },
  { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
  { code: 'ap-northeast-2', name: 'Asia Pacific (Seoul)' },
  { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
  { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
  { code: 'eu-west-1', name: 'Europe (Ireland)' },
  { code: 'eu-central-1', name: 'Europe (Frankfurt)' }
];

const RegionSelector = ({ 
  selectedRegion = 'us-east-1', 
  onRegionChange, 
  disabled = false,
  className = '' 
}) => {
  return (
    <div className={`region-selector ${className}`}>
      <label htmlFor="region-select" className="region-selector__label">
        AWS Region
      </label>
      <select
        id="region-select"
        className="region-selector__select"
        value={selectedRegion}
        onChange={(e) => onRegionChange(e.target.value)}
        disabled={disabled}
      >
        {AWS_REGIONS.map(region => (
          <option key={region.code} value={region.code}>
            {region.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RegionSelector;