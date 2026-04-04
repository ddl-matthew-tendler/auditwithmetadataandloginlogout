/**
 * Mock data for Audit Trail Exporter — used when Dummy Data toggle is on.
 */
var MOCK_CONFIG = {
  dominoHost: 'https://demo.domino.tech',
  datasets: [
    { label: 'local/audit-exports', path: '/domino/datasets/local/audit-exports' },
    { label: 'local/shared-data', path: '/domino/datasets/local/shared-data' },
  ],
  projectOwner: 'jane.doe',
  projectName: 'audit-trail-analysis',
  hasApiKey: true,
  hasKeycloak: true,
};

var MOCK_EVENT_NAMES = [
  'UserLogin', 'UserLogout', 'ProjectCreated', 'ProjectArchived',
  'WorkspaceStarted', 'WorkspaceStopped', 'JobStarted', 'JobCompleted',
  'JobFailed', 'ModelPublished', 'ModelVersionCreated', 'DatasetMounted',
  'DatasetUnmounted', 'EnvironmentCreated', 'EnvironmentRevisionAdded',
  'UserCreated', 'UserDeactivated', 'ProjectCollaboratorAdded',
  'ProjectCollaboratorRemoved', 'AppStarted', 'AppStopped',
  'HardwareTierChanged', 'ComputeClusterStarted', 'ComputeClusterStopped',
  'PermissionChanged', 'APIKeyGenerated', 'ExternalVolumeAttached',
];

var MOCK_USERS = [
  { name: 'jane.doe', firstName: 'Jane', lastName: 'Doe' },
  { name: 'john.smith', firstName: 'John', lastName: 'Smith' },
  { name: 'alice.chen', firstName: 'Alice', lastName: 'Chen' },
  { name: 'bob.kumar', firstName: 'Bob', lastName: 'Kumar' },
  { name: 'maria.garcia', firstName: 'Maria', lastName: 'Garcia' },
  { name: 'admin', firstName: 'System', lastName: 'Admin' },
  { name: 'david.lee', firstName: 'David', lastName: 'Lee' },
  { name: 'sarah.wilson', firstName: 'Sarah', lastName: 'Wilson' },
];

var MOCK_PROJECTS = [
  'drug-discovery-pipeline', 'clinical-trial-analysis', 'model-validation',
  'data-engineering', 'quarterly-report', 'ml-ops-infra', 'biomarker-study',
  'image-classification', null,
];

function generateMockExportRows(count) {
  var rows = [];
  var now = Date.now();
  for (var i = 0; i < count; i++) {
    var user = MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];
    var eventName = MOCK_EVENT_NAMES[Math.floor(Math.random() * MOCK_EVENT_NAMES.length)];
    var project = MOCK_PROJECTS[Math.floor(Math.random() * MOCK_PROJECTS.length)];
    var ts = now - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);
    var d = new Date(ts);
    var dateStr = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0') + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0');

    var row = {
      'Date & Time': dateStr,
      'User Name': user.name,
      'User First Name': user.firstName,
      'User Last Name': user.lastName,
      'Event': eventName,
      'Project': project,
    };

    // Add some metadata fields randomly
    if (Math.random() > 0.5) {
      row['Event Source'] = Math.random() > 0.5 ? 'UI' : 'API';
    }
    if (Math.random() > 0.6) {
      row['Meta: ipAddress'] = '10.' + Math.floor(Math.random() * 255) + '.' +
        Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255);
    }
    if (Math.random() > 0.7) {
      row['Meta: userAgent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    }
    if (eventName.indexOf('Collaborator') !== -1) {
      var target = MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];
      row['Target Entity Type'] = 'user';
      row['Target User'] = target.name;
      row['Target Entity Id'] = 'usr-' + Math.random().toString(36).substr(2, 8);
      row['Field Changed'] = 'role';
      row['Field Type'] = 'string';
      row['Before'] = 'Contributor';
      row['After'] = 'ResultsConsumer';
    }
    if (eventName === 'HardwareTierChanged') {
      row['Field Changed'] = 'hardwareTier';
      row['Field Type'] = 'string';
      row['Before'] = 'small-k8s';
      row['After'] = 'gpu-large-k8s';
    }

    rows.push(row);
  }
  // Sort newest first
  rows.sort(function(a, b) { return b['Date & Time'].localeCompare(a['Date & Time']); });
  return rows;
}

function generateMockExportResult() {
  var rows = generateMockExportRows(500);
  var columns = [
    'Date & Time', 'User Name', 'User First Name', 'User Last Name',
    'Event', 'Project', 'Event Source', 'Meta: ipAddress', 'Meta: userAgent',
    'Target Entity Type', 'Target User', 'Target Entity Id',
    'Field Changed', 'Field Type', 'Before', 'After',
  ];
  return {
    status: 'ok',
    rowCount: rows.length,
    rows: rows,
    columns: columns,
    csvData: null,
  };
}

function generateMockExploreResult() {
  var rows = generateMockExportRows(300);
  var columns = [
    'Date & Time', 'User Name', 'User First Name', 'User Last Name',
    'Event', 'Project', 'Event Source', 'Meta: ipAddress',
    'Target Entity Type', 'Target User', 'Target Entity Id',
    'Field Changed', 'Field Type', 'Before', 'After',
  ];

  // Event rollup
  var eventCounts = {};
  rows.forEach(function(r) {
    var e = r['Event'] || 'Unknown';
    eventCounts[e] = (eventCounts[e] || 0) + 1;
  });
  var eventRollup = Object.keys(eventCounts).map(function(k) {
    return { Event: k, count: eventCounts[k] };
  }).sort(function(a, b) { return b.count - a.count; }).slice(0, 20);

  // Actor rollup
  var actorCounts = {};
  rows.forEach(function(r) {
    var a = r['User Name'] || 'Unknown';
    actorCounts[a] = (actorCounts[a] || 0) + 1;
  });
  var actorRollup = Object.keys(actorCounts).map(function(k) {
    return { actor: k, count: actorCounts[k] };
  }).sort(function(a, b) { return b.count - a.count; }).slice(0, 20);

  return {
    status: 'ok',
    rows: rows,
    columns: columns,
    totalRows: rows.length,
    eventRollup: eventRollup,
    actorRollup: actorRollup,
  };
}

// ---------------------------------------------------------------------------
// Login Audit mock data (Keycloak login/logout events)
// ---------------------------------------------------------------------------

var MOCK_LOGIN_EVENT_TYPES = [
  { type: 'LOGIN', weight: 50 },
  { type: 'LOGIN_ERROR', weight: 15 },
  { type: 'LOGOUT', weight: 30 },
  { type: 'LOGOUT_ERROR', weight: 5 },
];

var MOCK_LOGIN_ERROR_REASONS = [
  'invalid_user_credentials', 'user_not_found', 'user_disabled',
  'user_temporarily_disabled', 'expired_code', 'invalid_client_credentials',
];

var MOCK_CLIENT_IDS = [
  'domino-play', 'domino-nucleus', 'domino-api', 'domino-app-launcher',
];

function _pickWeighted(items) {
  var total = items.reduce(function(s, i) { return s + i.weight; }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < items.length; i++) {
    r -= items[i].weight;
    if (r <= 0) return items[i].type;
  }
  return items[0].type;
}

function generateMockLoginRows(count) {
  var rows = [];
  var now = Date.now();
  for (var i = 0; i < count; i++) {
    var user = MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];
    var eventType = _pickWeighted(MOCK_LOGIN_EVENT_TYPES);
    var isError = eventType.indexOf('_ERROR') !== -1;
    var ts = now - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);
    var d = new Date(ts);
    var dateStr = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0') + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0');

    var row = {
      'Date & Time': dateStr,
      'User Name': user.name,
      'User First Name': user.firstName,
      'User Last Name': user.lastName,
      'Event': eventType,
      'Event Source': 'Keycloak',
      'Project': null,
      'Meta: ipAddress': '10.' + Math.floor(Math.random() * 255) + '.' +
        Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255),
      'Meta: sessionId': 'sess-' + Math.random().toString(36).substr(2, 12),
      'Meta: clientId': MOCK_CLIENT_IDS[Math.floor(Math.random() * MOCK_CLIENT_IDS.length)],
      'Meta: keycloakUserId': 'kc-' + Math.random().toString(36).substr(2, 8),
      'Meta: email': user.name.replace('.', '_') + '@example.com',
      'Meta: outcome': isError ? 'FAILURE' : 'SUCCESS',
    };

    if (isError) {
      row['Meta: errorReason'] = MOCK_LOGIN_ERROR_REASONS[
        Math.floor(Math.random() * MOCK_LOGIN_ERROR_REASONS.length)
      ];
    }

    rows.push(row);
  }
  rows.sort(function(a, b) { return b['Date & Time'].localeCompare(a['Date & Time']); });
  return rows;
}

function generateMockLoginResult() {
  var rows = generateMockLoginRows(400);
  var columns = [
    'Date & Time', 'User Name', 'User First Name', 'User Last Name',
    'Event', 'Event Source', 'Meta: ipAddress', 'Meta: sessionId',
    'Meta: clientId', 'Meta: keycloakUserId', 'Meta: email',
    'Meta: outcome', 'Meta: errorReason',
  ];

  // Event rollup
  var eventCounts = {};
  rows.forEach(function(r) {
    var e = r['Event'] || 'Unknown';
    eventCounts[e] = (eventCounts[e] || 0) + 1;
  });
  var eventRollup = Object.keys(eventCounts).map(function(k) {
    return { Event: k, count: eventCounts[k] };
  }).sort(function(a, b) { return b.count - a.count; });

  // Actor rollup
  var actorCounts = {};
  rows.forEach(function(r) {
    var a = r['User Name'] || 'Unknown';
    actorCounts[a] = (actorCounts[a] || 0) + 1;
  });
  var actorRollup = Object.keys(actorCounts).map(function(k) {
    return { actor: k, count: actorCounts[k] };
  }).sort(function(a, b) { return b.count - a.count; });

  // Outcome rollup
  var outcomeCounts = {};
  rows.forEach(function(r) {
    var o = r['Meta: outcome'] || 'Unknown';
    outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
  });
  var outcomeRollup = Object.keys(outcomeCounts).map(function(k) {
    return { outcome: k, count: outcomeCounts[k] };
  });

  // Hourly rollup
  var hourlyCounts = {};
  rows.forEach(function(r) {
    var dt = r['Date & Time'];
    if (dt) {
      var hour = parseInt(dt.split(' ')[1].split(':')[0], 10);
      hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
    }
  });
  var hourlyRollup = Object.keys(hourlyCounts).map(function(k) {
    return { hour: parseInt(k, 10), count: hourlyCounts[k] };
  }).sort(function(a, b) { return a.hour - b.hour; });

  return {
    status: 'ok',
    eventCount: rows.length,
    rowCount: rows.length,
    rows: rows,
    columns: columns,
    csvData: null,
    eventRollup: eventRollup,
    actorRollup: actorRollup,
    outcomeRollup: outcomeRollup,
    hourlyRollup: hourlyRollup,
  };
}
