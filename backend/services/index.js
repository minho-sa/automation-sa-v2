const stsService = require('./stsService');
const dynamoService = require('./dynamoService');
const cognitoService = require('./cognitoService');
const historyService = require('./historyService');
const inspectors = require('./inspectors');

module.exports = {
  stsService,
  dynamoService,
  cognitoService,
  historyService,
  inspectors,
};