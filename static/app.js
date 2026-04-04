/**
 * Domino Audit Trail Exporter — Ant Design + React frontend
 */
var h = React.createElement;
var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;
var useRef = React.useRef;

var ConfigProvider = antd.ConfigProvider;
var Layout = antd.Layout;
var Tabs = antd.Tabs;
var Button = antd.Button;
var Input = antd.Input;
var InputNumber = antd.InputNumber;
var DatePicker = antd.DatePicker;
var Select = antd.Select;
var Table = antd.Table;
var Tag = antd.Tag;
var Alert = antd.Alert;
var Switch = antd.Switch;
var Spin = antd.Spin;
var Progress = antd.Progress;
var Space = antd.Space;
var Card = antd.Card;
var Tooltip = antd.Tooltip;
var Typography = antd.Typography;
var Collapse = antd.Collapse;
var Empty = antd.Empty;
var message = antd.message;
var RangePicker = DatePicker.RangePicker;

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
var dominoTheme = {
  token: {
    colorPrimary: '#543FDE',
    colorPrimaryHover: '#3B23D1',
    colorPrimaryActive: '#311EAE',
    colorText: '#2E2E38',
    colorTextSecondary: '#65657B',
    colorTextTertiary: '#8F8FA3',
    colorSuccess: '#28A464',
    colorWarning: '#CCB718',
    colorError: '#C20A29',
    colorInfo: '#0070CC',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#FAFAFA',
    colorBorder: '#E0E0E0',
    fontFamily: 'Inter, Lato, Helvetica Neue, Helvetica, Arial, sans-serif',
    fontSize: 14,
    borderRadius: 4,
    borderRadiusLG: 8,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none' },
    Table: { headerBg: '#FAFAFA', rowHoverBg: '#F5F5F5' },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function apiPost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || r.statusText); });
    return r.json();
  });
}

function apiGet(url) {
  return fetch(url).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || r.statusText); });
    return r.json();
  });
}

function downloadCsv(csvString, filename) {
  var blob = new Blob([csvString], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadPdf(rows, columns, meta) {
  return fetch('api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: rows, columns: columns, meta: meta }),
  }).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'PDF export failed'); });
    return r.blob();
  }).then(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var today = dayjs().format('YYYYMMDD');
    a.download = 'audit_trail_report_' + today + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

function rowsToCsv(rows, columns) {
  if (!rows || !rows.length) return '';
  var cols = columns || Object.keys(rows[0]);
  var lines = [cols.join(',')];
  rows.forEach(function(r) {
    var vals = cols.map(function(c) {
      var v = r[c];
      if (v == null) return '';
      var s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    lines.push(vals.join(','));
  });
  return lines.join('\n');
}

// Highcharts Domino palette
if (typeof Highcharts !== 'undefined') {
  Highcharts.setOptions({
    colors: ['#543FDE', '#0070CC', '#28A464', '#CCB718', '#FF6543', '#E835A7', '#2EDCC4', '#A9734C'],
    chart: { style: { fontFamily: 'Inter, Lato, Helvetica Neue, Arial, sans-serif' } },
  });
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------
function StatCard(props) {
  var cls = 'stat-card' + (props.onClick ? ' stat-card-clickable' : '') + (props.active ? ' stat-card-active' : '');
  return h('div', { className: cls, onClick: props.onClick || null },
    h('div', { className: 'stat-card-label' }, props.label),
    h('div', { className: 'stat-card-value ' + (props.color || '') }, props.value),
    props.sub ? h('div', { className: 'stat-card-sub' }, props.sub) : null
  );
}

// ---------------------------------------------------------------------------
// TopNav
// ---------------------------------------------------------------------------
function TopNav(props) {
  return h('div', { className: 'top-nav' },
    h('div', { className: 'top-nav-left' },
      h('img', { src: 'static/domino-logo.svg', alt: 'Domino', className: 'top-nav-logo' }),
      h('span', { className: 'top-nav-title' }, 'Audit Trail Exporter')
    ),
    h('div', { className: 'top-nav-right' },
      h('div', { className: 'dummy-data-toggle' },
        h('span', null, 'Dummy Data'),
        h(Switch, { checked: props.useDummy, onChange: props.onToggleDummy, size: 'small' })
      ),
      props.projectContext ? h('span', { className: 'top-nav-context' }, props.projectContext) : null
    )
  );
}

// ---------------------------------------------------------------------------
// Export Tab
// ---------------------------------------------------------------------------
function ExportTab(props) {
  var config = props.config;
  var useDummy = props.useDummy;

  var _host = useState(config.dominoHost || '');
  var dominoHost = _host[0]; var setDominoHost = _host[1];

  var _ds = useState(config.datasets && config.datasets.length ? config.datasets[0].path : '');
  var datasetPath = _ds[0]; var setDatasetPath = _ds[1];

  var _dates = useState([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  var dateRange = _dates[0]; var setDateRange = _dates[1];

  var _max = useState(1000000);
  var maxRows = _max[0]; var setMaxRows = _max[1];

  var _loading = useState(false);
  var loading = _loading[0]; var setLoading = _loading[1];

  var _result = useState(null);
  var result = _result[0]; var setResult = _result[1];

  var _error = useState(null);
  var error = _error[0]; var setError = _error[1];

  var _pdfLoading = useState(false);
  var pdfLoading = _pdfLoading[0]; var setPdfLoading = _pdfLoading[1];

  // Sync config when it changes
  useEffect(function() {
    if (config.dominoHost) setDominoHost(config.dominoHost);
    if (config.datasets && config.datasets.length) setDatasetPath(config.datasets[0].path);
  }, [config]);

  var datasetOptions = useMemo(function() {
    return (config.datasets || []).map(function(d) {
      return { label: d.label, value: d.path };
    });
  }, [config.datasets]);

  function handleExport() {
    if (useDummy) {
      setLoading(true);
      setTimeout(function() {
        setResult(generateMockExportResult());
        setLoading(false);
        message.success('Export complete (dummy data)');
      }, 1500);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    var body = {
      dominoHost: dominoHost,
      datasetPath: datasetPath,
      startDate: dateRange && dateRange[0] ? dateRange[0].format('YYYY-MM-DD') : undefined,
      endDate: dateRange && dateRange[1] ? dateRange[1].format('YYYY-MM-DD') : undefined,
      maxRows: maxRows,
    };

    apiPost('api/export', body)
      .then(function(data) {
        setResult(data);
        setLoading(false);
        if (data.status === 'empty') {
          message.warning(data.message);
        } else {
          message.success('Export complete: ' + data.eventCount + ' events, ' + data.rowCount + ' rows');
        }
      })
      .catch(function(err) {
        setError(err.message);
        setLoading(false);
      });
  }

  // Build table columns from result
  var columns = useMemo(function() {
    if (!result || !result.columns) return [];
    return result.columns.map(function(col) {
      var cfg = {
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
        width: col === 'Date & Time' ? 170 : (col === 'Event' ? 200 : 150),
        sorter: function(a, b) {
          var va = a[col] || '';
          var vb = b[col] || '';
          return String(va).localeCompare(String(vb));
        },
      };
      if (col === 'Event') {
        cfg.render = function(val) {
          if (!val) return '\u2014';
          return h(Tag, { color: 'purple' }, val);
        };
      }
      return cfg;
    });
  }, [result]);

  var tableData = useMemo(function() {
    if (!result || !result.previewRows) return [];
    return result.previewRows.map(function(r, i) {
      return Object.assign({}, r, { _key: i });
    });
  }, [result]);

  return h('div', { className: 'tab-content' },
    // Config section
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Configuration')
      ),
      h('div', { className: 'config-grid' },
        h('div', { className: 'config-field' },
          h('label', null, 'Domino Host'),
          h(Input, {
            value: dominoHost,
            onChange: function(e) { setDominoHost(e.target.value); },
            placeholder: 'https://your.domino.tech',
            disabled: useDummy,
          })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Destination Dataset'),
          h(Select, {
            value: datasetPath || undefined,
            onChange: setDatasetPath,
            options: datasetOptions,
            placeholder: useDummy ? 'local/audit-exports' : 'Select dataset',
            disabled: useDummy,
            style: { width: '100%' },
          })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Date Range'),
          h(RangePicker, {
            value: dateRange,
            onChange: setDateRange,
            style: { width: '100%' },
          })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Max Rows'),
          h(InputNumber, {
            value: maxRows,
            onChange: setMaxRows,
            min: 1000,
            step: 100000,
            style: { width: '100%' },
            formatter: function(v) { return v ? v.toLocaleString() : ''; },
          })
        ),
        h('div', { className: 'config-field config-field-action' },
          h(Button, {
            type: 'primary',
            size: 'large',
            onClick: handleExport,
            loading: loading,
            block: true,
          }, 'Generate Audit Trail Export')
        )
      )
    ),

    // Error
    error ? h(Alert, {
      type: 'error',
      message: 'Export Failed',
      description: error,
      showIcon: true,
      closable: true,
      onClose: function() { setError(null); },
      style: { marginBottom: 16 },
    }) : null,

    // Loading
    loading ? h('div', { className: 'loading-container' },
      h(Spin, { size: 'large' }),
      h('p', null, 'Fetching audit events... this may take a few minutes for large exports.')
    ) : null,

    // Results
    result && result.status === 'ok' ? h('div', null,
      // Stats
      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Events Fetched', value: (result.eventCount || 0).toLocaleString(), color: 'primary' }),
        h(StatCard, { label: 'Rows Generated', value: (result.rowCount || 0).toLocaleString(), color: 'info' }),
        h(StatCard, { label: 'Files Saved', value: (result.filesSaved || []).length, color: 'success' })
      ),

      // Files saved
      result.filesSaved && result.filesSaved.length ? h('div', { className: 'panel', style: { marginBottom: 16 } },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, 'Files Saved'),
          h('div', { className: 'panel-header-actions' },
            (result.csvData || result.previewRows) ? h(Button, {
              type: 'primary',
              size: 'small',
              onClick: function() {
                var today = dayjs().format('YYYYMMDD');
                var csv = result.csvData || rowsToCsv(result.previewRows, result.columns);
                downloadCsv(csv, 'audit_full_metadata_friendly_' + today + '.csv');
              },
            }, 'Download CSV') : null,
            result.previewRows && result.previewRows.length ? h(Button, {
              size: 'small',
              loading: pdfLoading,
              onClick: function() {
                setPdfLoading(true);
                var dr = dateRange;
                var meta = {
                  generated: dayjs().format('YYYY-MM-DD HH:mm:ss') + ' UTC',
                  records: result.rowCount || result.previewRows.length,
                  dateRange: dr && dr[0] && dr[1] ? dr[0].format('YYYY-MM-DD') + ' to ' + dr[1].format('YYYY-MM-DD') : 'N/A',
                  system: dominoHost || 'Domino',
                };
                downloadPdf(result.previewRows, result.columns, meta)
                  .then(function() { setPdfLoading(false); message.success('PDF downloaded'); })
                  .catch(function(err) { setPdfLoading(false); message.error(err.message || 'PDF export failed'); });
              },
            }, 'Export PDF') : null
          )
        ),
        h('div', { className: 'files-list' },
          result.filesSaved.map(function(f, i) {
            return h('div', { key: i, className: 'file-item' },
              h('span', { className: 'file-icon' }, f.endsWith('.json') ? '{ }' : f.endsWith('.csv') ? 'CSV' : 'PQ'),
              h('span', { className: 'file-path' }, f)
            );
          })
        )
      ) : null,

      // Preview table
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, 'Preview'),
          h('span', { className: 'panel-subtitle' }, 'First 200 rows')
        ),
        h(Table, {
          dataSource: tableData,
          columns: columns,
          rowKey: '_key',
          size: 'small',
          scroll: { x: 'max-content', y: 500 },
          pagination: { pageSize: 50, showSizeChanger: true, showTotal: function(t) { return t + ' rows'; } },
        })
      )
    ) : null
  );
}

// ---------------------------------------------------------------------------
// Explore Tab
// ---------------------------------------------------------------------------
function ExploreTab(props) {
  var config = props.config;
  var useDummy = props.useDummy;

  var _ds = useState(config.datasets && config.datasets.length ? config.datasets[0].path : '');
  var datasetPath = _ds[0]; var setDatasetPath = _ds[1];

  var _dates = useState([dayjs().subtract(7, 'day'), dayjs()]);
  var dateRange = _dates[0]; var setDateRange = _dates[1];

  var _limit = useState(5000);
  var limit = _limit[0]; var setLimit = _limit[1];

  var _loading = useState(false);
  var loading = _loading[0]; var setLoading = _loading[1];

  var _result = useState(null);
  var result = _result[0]; var setResult = _result[1];

  var _error = useState(null);
  var error = _error[0]; var setError = _error[1];

  var _tableFilter = useState(null);
  var tableFilter = _tableFilter[0]; var setTableFilter = _tableFilter[1];

  var eventChartRef = useRef(null);
  var actorChartRef = useRef(null);

  useEffect(function() {
    if (config.datasets && config.datasets.length) setDatasetPath(config.datasets[0].path);
  }, [config.datasets]);

  var datasetOptions = useMemo(function() {
    return (config.datasets || []).map(function(d) { return { label: d.label, value: d.path }; });
  }, [config.datasets]);

  function handleExplore() {
    if (useDummy) {
      setLoading(true);
      setTimeout(function() {
        var data = generateMockExploreResult();
        setResult(data);
        setLoading(false);
        setTableFilter(null);
      }, 800);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setTableFilter(null);

    apiPost('api/explore', {
      datasetPath: datasetPath,
      startDate: dateRange && dateRange[0] ? dateRange[0].format('YYYY-MM-DD') : '',
      endDate: dateRange && dateRange[1] ? dateRange[1].format('YYYY-MM-DD') : '',
      limit: limit,
    })
    .then(function(data) {
      setResult(data);
      setLoading(false);
      if (data.status === 'empty') message.info(data.message);
    })
    .catch(function(err) {
      setError(err.message);
      setLoading(false);
    });
  }

  // Render charts when result changes
  useEffect(function() {
    if (!result || result.status !== 'ok') return;

    // Event rollup chart
    if (result.eventRollup && result.eventRollup.length && eventChartRef.current) {
      var eventData = result.eventRollup.slice(0, 15).map(function(r) {
        return { name: r.Event || 'Unknown', y: r.count };
      });
      Highcharts.chart(eventChartRef.current, {
        chart: { type: 'bar', height: 320 },
        title: { text: 'Top Events', style: { fontSize: '14px', fontWeight: '600' } },
        xAxis: { categories: eventData.map(function(d) { return d.name; }), labels: { style: { fontSize: '11px' } } },
        yAxis: { title: { text: null }, allowDecimals: false },
        series: [{ name: 'Count', data: eventData.map(function(d) { return d.y; }), colorByPoint: false }],
        legend: { enabled: false },
        credits: { enabled: false },
        plotOptions: {
          bar: {
            cursor: 'pointer',
            point: {
              events: {
                click: function() {
                  setTableFilter(tableFilter && tableFilter.value === this.category
                    ? null : { type: 'event', value: this.category });
                }
              }
            }
          }
        },
      });
    }

    // Actor rollup chart
    if (result.actorRollup && result.actorRollup.length && actorChartRef.current) {
      var actorData = result.actorRollup.slice(0, 10).map(function(r) {
        return { name: r.actor || 'Unknown', y: r.count };
      });
      Highcharts.chart(actorChartRef.current, {
        chart: { type: 'pie', height: 320 },
        title: { text: 'Top Actors', style: { fontSize: '14px', fontWeight: '600' } },
        series: [{
          name: 'Events',
          data: actorData,
          innerSize: '50%',
        }],
        tooltip: { pointFormat: '<b>{point.y}</b> events ({point.percentage:.1f}%)' },
        credits: { enabled: false },
        plotOptions: {
          pie: {
            cursor: 'pointer',
            dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '11px' } },
            point: {
              events: {
                click: function() {
                  setTableFilter(tableFilter && tableFilter.value === this.name
                    ? null : { type: 'actor', value: this.name });
                }
              }
            }
          }
        },
      });
    }
  }, [result]);

  // Table data filtered by chart click
  var filteredRows = useMemo(function() {
    if (!result || !result.rows) return [];
    var rows = result.rows;
    if (tableFilter) {
      if (tableFilter.type === 'event') {
        rows = rows.filter(function(r) { return r['Event'] === tableFilter.value; });
      } else if (tableFilter.type === 'actor') {
        rows = rows.filter(function(r) { return r['User Name'] === tableFilter.value; });
      }
    }
    return rows.map(function(r, i) { return Object.assign({}, r, { _key: i }); });
  }, [result, tableFilter]);

  // Build dynamic columns
  var columns = useMemo(function() {
    if (!result || !result.columns) return [];
    return result.columns.map(function(col) {
      var cfg = {
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
        width: col === 'Date & Time' ? 170 : (col === 'Event' ? 200 : 150),
        sorter: function(a, b) {
          var va = a[col] || '';
          var vb = b[col] || '';
          return String(va).localeCompare(String(vb));
        },
      };
      if (col === 'Event') {
        // Unique values for filter
        var unique = {};
        (result.rows || []).forEach(function(r) { if (r[col]) unique[r[col]] = true; });
        cfg.filters = Object.keys(unique).sort().map(function(v) { return { text: v, value: v }; });
        cfg.onFilter = function(value, record) { return record[col] === value; };
        cfg.render = function(val) { return val ? h(Tag, { color: 'purple' }, val) : '\u2014'; };
      }
      if (col === 'User Name') {
        var uniqueUsers = {};
        (result.rows || []).forEach(function(r) { if (r[col]) uniqueUsers[r[col]] = true; });
        cfg.filters = Object.keys(uniqueUsers).sort().map(function(v) { return { text: v, value: v }; });
        cfg.onFilter = function(value, record) { return record[col] === value; };
      }
      return cfg;
    });
  }, [result]);

  var filterLabel = tableFilter ? tableFilter.value : null;

  return h('div', { className: 'tab-content' },
    // Controls
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Explore Exported Data')
      ),
      h('div', { className: 'explore-controls' },
        h('div', { className: 'config-field' },
          h('label', null, 'Dataset'),
          h(Select, {
            value: datasetPath || undefined,
            onChange: setDatasetPath,
            options: datasetOptions,
            placeholder: useDummy ? 'local/audit-exports' : 'Select dataset',
            disabled: useDummy,
            style: { width: '100%' },
          })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Date Range'),
          h(RangePicker, { value: dateRange, onChange: setDateRange, style: { width: '100%' } })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Preview Limit'),
          h(InputNumber, { value: limit, onChange: setLimit, min: 100, max: 50000, step: 100, style: { width: '100%' } })
        ),
        h('div', { className: 'config-field config-field-action' },
          h(Button, { type: 'primary', onClick: handleExplore, loading: loading }, 'Query Data')
        )
      )
    ),

    error ? h(Alert, { type: 'error', message: error, showIcon: true, closable: true, onClose: function() { setError(null); }, style: { marginBottom: 16 } }) : null,

    loading ? h('div', { className: 'loading-container' }, h(Spin, { size: 'large' })) : null,

    result && result.status === 'ok' ? h('div', null,
      // Stats
      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Total Rows', value: (result.totalRows || 0).toLocaleString(), color: 'primary' }),
        h(StatCard, { label: 'Unique Events', value: (result.eventRollup || []).length, color: 'info' }),
        h(StatCard, { label: 'Unique Actors', value: (result.actorRollup || []).length, color: 'success' })
      ),

      // Charts
      h('div', { className: 'charts-row' },
        h('div', { className: 'chart-panel' },
          h('div', { ref: eventChartRef, style: { width: '100%', minHeight: 320 } })
        ),
        h('div', { className: 'chart-panel' },
          h('div', { ref: actorChartRef, style: { width: '100%', minHeight: 320 } })
        )
      ),

      // Table
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, filterLabel ? 'Events \u2014 ' + filterLabel : 'All Events'),
          h('div', { className: 'panel-header-actions' },
            filterLabel ? h(Tag, {
              closable: true,
              onClose: function() { setTableFilter(null); },
              color: 'purple',
            }, filterLabel) : null,
            h(Button, {
              size: 'small',
              onClick: function() {
                var csv = rowsToCsv(filteredRows, result.columns);
                var ts = dayjs().format('YYYYMMDD_HHmmss');
                downloadCsv(csv, 'audit_subset_' + ts + '.csv');
              },
            }, 'Export CSV')
          )
        ),
        h(Table, {
          dataSource: filteredRows,
          columns: columns,
          rowKey: '_key',
          size: 'small',
          scroll: { x: 'max-content', y: 500 },
          pagination: { pageSize: 50, showSizeChanger: true, showTotal: function(t) { return t + ' rows'; } },
        })
      )
    ) : null,

    result && result.status === 'empty' ? h(Empty, { description: result.message }) : null
  );
}

// ---------------------------------------------------------------------------
// Login Audit Tab (21 CFR Part 11)
// ---------------------------------------------------------------------------
function LoginAuditTab(props) {
  var config = props.config;
  var useDummy = props.useDummy;

  var _dates = useState([dayjs().subtract(30, 'day'), dayjs()]);
  var dateRange = _dates[0]; var setDateRange = _dates[1];

  var _includeAll = useState(false);
  var includeAllAuth = _includeAll[0]; var setIncludeAllAuth = _includeAll[1];

  var _loading = useState(false);
  var loading = _loading[0]; var setLoading = _loading[1];

  var _result = useState(null);
  var result = _result[0]; var setResult = _result[1];

  var _error = useState(null);
  var error = _error[0]; var setError = _error[1];

  var _tableFilter = useState(null);
  var tableFilter = _tableFilter[0]; var setTableFilter = _tableFilter[1];

  var _pdfLoading2 = useState(false);
  var pdfLoading2 = _pdfLoading2[0]; var setPdfLoading2 = _pdfLoading2[1];

  var outcomeChartRef = useRef(null);
  var eventChartRef = useRef(null);
  var hourlyChartRef = useRef(null);
  var actorChartRef = useRef(null);

  function handleFetch() {
    if (useDummy || !hasKeycloak) {
      setLoading(true);
      setTimeout(function() {
        var data = generateMockLoginResult();
        setResult(data);
        setLoading(false);
        setTableFilter(null);
        message.success('Login audit loaded (dummy data)');
      }, 1000);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setTableFilter(null);

    apiPost('api/login-events', {
      startDate: dateRange && dateRange[0] ? dateRange[0].format('YYYY-MM-DD') : undefined,
      endDate: dateRange && dateRange[1] ? dateRange[1].format('YYYY-MM-DD') : undefined,
      includeAllAuth: includeAllAuth,
    })
    .then(function(data) {
      setResult(data);
      setLoading(false);
      if (data.status === 'empty') {
        message.info(data.message);
      } else {
        message.success('Loaded ' + data.eventCount + ' login events');
      }
    })
    .catch(function(err) {
      setError(err.message);
      setLoading(false);
    });
  }

  // Render charts
  useEffect(function() {
    if (!result || result.status !== 'ok') return;

    // Outcome donut (Success vs Failure)
    if (result.outcomeRollup && result.outcomeRollup.length && outcomeChartRef.current) {
      var outcomeColors = { SUCCESS: '#28A464', FAILURE: '#C20A29' };
      var outcomeData = result.outcomeRollup.map(function(r) {
        return { name: r.outcome, y: r.count, color: outcomeColors[r.outcome] || '#8F8FA3' };
      });
      Highcharts.chart(outcomeChartRef.current, {
        chart: { type: 'pie', height: 260 },
        title: { text: 'Success vs Failure', style: { fontSize: '14px', fontWeight: '600' } },
        series: [{ name: 'Events', data: outcomeData, innerSize: '60%' }],
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: { pie: {
          cursor: 'pointer',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '12px' } },
          point: { events: { click: function() {
            setTableFilter(tableFilter && tableFilter.value === this.name ? null : { type: 'outcome', value: this.name });
          }}}
        }},
        legend: { enabled: false },
        credits: { enabled: false },
      });
    }

    // Event type bar chart
    if (result.eventRollup && result.eventRollup.length && eventChartRef.current) {
      var evtColors = { LOGIN: '#28A464', LOGIN_ERROR: '#C20A29', LOGOUT: '#0070CC', LOGOUT_ERROR: '#CCB718' };
      var evtData = result.eventRollup.map(function(r) {
        return { name: r.Event, y: r.count, color: evtColors[r.Event] || '#543FDE' };
      });
      Highcharts.chart(eventChartRef.current, {
        chart: { type: 'column', height: 260 },
        title: { text: 'Events by Type', style: { fontSize: '14px', fontWeight: '600' } },
        xAxis: { categories: evtData.map(function(d) { return d.name; }), labels: { style: { fontSize: '11px' } } },
        yAxis: { title: { text: null }, allowDecimals: false },
        series: [{ name: 'Count', data: evtData, colorByPoint: true }],
        legend: { enabled: false },
        credits: { enabled: false },
        plotOptions: { column: { cursor: 'pointer', point: { events: { click: function() {
          setTableFilter(tableFilter && tableFilter.value === this.category ? null : { type: 'event', value: this.category });
        }}}}},
      });
    }

    // Hourly distribution
    if (result.hourlyRollup && result.hourlyRollup.length && hourlyChartRef.current) {
      var hours = [];
      var counts = [];
      for (var hr = 0; hr < 24; hr++) {
        hours.push(hr + ':00');
        var match = result.hourlyRollup.find(function(r) { return r.hour === hr; });
        counts.push(match ? match.count : 0);
      }
      Highcharts.chart(hourlyChartRef.current, {
        chart: { type: 'area', height: 260 },
        title: { text: 'Login Activity by Hour (UTC)', style: { fontSize: '14px', fontWeight: '600' } },
        xAxis: { categories: hours, labels: { step: 2, style: { fontSize: '10px' } } },
        yAxis: { title: { text: null }, allowDecimals: false },
        series: [{ name: 'Events', data: counts, color: '#543FDE', fillOpacity: 0.15 }],
        legend: { enabled: false },
        credits: { enabled: false },
      });
    }

    // Top users bar chart
    if (result.actorRollup && result.actorRollup.length && actorChartRef.current) {
      var actData = result.actorRollup.slice(0, 10).map(function(r) {
        return { name: r.actor || 'Unknown', y: r.count };
      });
      Highcharts.chart(actorChartRef.current, {
        chart: { type: 'bar', height: 260 },
        title: { text: 'Top Users', style: { fontSize: '14px', fontWeight: '600' } },
        xAxis: { categories: actData.map(function(d) { return d.name; }), labels: { style: { fontSize: '11px' } } },
        yAxis: { title: { text: null }, allowDecimals: false },
        series: [{ name: 'Events', data: actData.map(function(d) { return d.y; }) }],
        legend: { enabled: false },
        credits: { enabled: false },
        plotOptions: { bar: { cursor: 'pointer', point: { events: { click: function() {
          setTableFilter(tableFilter && tableFilter.value === this.category ? null : { type: 'actor', value: this.category });
        }}}}},
      });
    }
  }, [result]);

  // Filtered rows
  var filteredRows = useMemo(function() {
    if (!result || !result.rows) return [];
    var rows = result.rows;
    if (tableFilter) {
      if (tableFilter.type === 'event') {
        rows = rows.filter(function(r) { return r['Event'] === tableFilter.value; });
      } else if (tableFilter.type === 'actor') {
        rows = rows.filter(function(r) { return r['User Name'] === tableFilter.value; });
      } else if (tableFilter.type === 'outcome') {
        rows = rows.filter(function(r) { return r['Meta: outcome'] === tableFilter.value; });
      }
    }
    return rows.map(function(r, i) { return Object.assign({}, r, { _key: i }); });
  }, [result, tableFilter]);

  // Dynamic columns
  var columns = useMemo(function() {
    if (!result || !result.columns) return [];
    return result.columns.map(function(col) {
      var cfg = {
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
        width: col === 'Date & Time' ? 170 : (col === 'Event' ? 140 : 150),
        sorter: function(a, b) {
          var va = a[col] || '';
          var vb = b[col] || '';
          return String(va).localeCompare(String(vb));
        },
      };
      if (col === 'Event') {
        var colorMap = { LOGIN: 'green', LOGIN_ERROR: 'red', LOGOUT: 'blue', LOGOUT_ERROR: 'orange' };
        cfg.filters = [
          { text: 'LOGIN', value: 'LOGIN' },
          { text: 'LOGIN_ERROR', value: 'LOGIN_ERROR' },
          { text: 'LOGOUT', value: 'LOGOUT' },
          { text: 'LOGOUT_ERROR', value: 'LOGOUT_ERROR' },
        ];
        cfg.onFilter = function(value, record) { return record[col] === value; };
        cfg.render = function(val) {
          if (!val) return '\u2014';
          return h(Tag, { color: colorMap[val] || 'default' }, val);
        };
      }
      if (col === 'Meta: outcome') {
        cfg.render = function(val) {
          if (!val) return '\u2014';
          return h(Tag, { color: val === 'SUCCESS' ? 'green' : 'red' }, val);
        };
      }
      if (col === 'User Name') {
        var uniqueUsers = {};
        (result.rows || []).forEach(function(r) { if (r[col]) uniqueUsers[r[col]] = true; });
        cfg.filters = Object.keys(uniqueUsers).sort().map(function(v) { return { text: v, value: v }; });
        cfg.onFilter = function(value, record) { return record[col] === value; };
      }
      return cfg;
    });
  }, [result]);

  var filterLabel = tableFilter ? tableFilter.value : null;
  var hasKeycloak = config.hasKeycloak;

  return h('div', { className: 'tab-content' },
    // Keycloak not configured warning
    !hasKeycloak && !useDummy ? h(Alert, {
      type: 'warning',
      showIcon: true,
      message: 'Keycloak Not Configured',
      description: 'Set KEYCLOAK_HOST and KEYCLOAK_PASSWORD environment variables to connect to your Domino Keycloak instance. Using dummy data for now.',
      style: { marginBottom: 16 },
    }) : null,

    // Controls
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Query Login Events')
      ),
      h('div', { className: 'explore-controls' },
        h('div', { className: 'config-field' },
          h('label', null, 'Date Range'),
          h(RangePicker, { value: dateRange, onChange: setDateRange, style: { width: '100%' } })
        ),
        h('div', { className: 'config-field' },
          h('label', null, 'Include All Auth Events'),
          h('div', null,
            h(Switch, {
              checked: includeAllAuth,
              onChange: setIncludeAllAuth,
              size: 'small',
            }),
            h('span', { style: { marginLeft: 8, color: '#65657B', fontSize: 12 } },
              includeAllAuth ? 'Includes token exchanges & client logins' : 'Login & logout only'
            )
          )
        ),
        h('div', { className: 'config-field config-field-action' },
          h(Button, { type: 'primary', onClick: handleFetch, loading: loading }, 'Fetch Login Events')
        )
      )
    ),

    error ? h(Alert, { type: 'error', message: error, showIcon: true, closable: true, onClose: function() { setError(null); }, style: { marginBottom: 16 } }) : null,
    loading ? h('div', { className: 'loading-container' }, h(Spin, { size: 'large' }), h('p', null, 'Querying Keycloak events...')) : null,

    result && result.status === 'ok' ? h('div', null,
      // Stats row
      h('div', { className: 'stats-row' },
        h(StatCard, {
          label: 'Total Events', value: (result.eventCount || 0).toLocaleString(), color: 'primary',
        }),
        h(StatCard, {
          label: 'Successful Logins',
          value: (result.outcomeRollup || []).reduce(function(s, r) { return r.outcome === 'SUCCESS' ? s + r.count : s; }, 0).toLocaleString(),
          color: 'success',
        }),
        h(StatCard, {
          label: 'Failed Attempts',
          value: (result.outcomeRollup || []).reduce(function(s, r) { return r.outcome === 'FAILURE' ? s + r.count : s; }, 0).toLocaleString(),
          color: 'error',
        }),
        h(StatCard, {
          label: 'Unique Users', value: (result.actorRollup || []).length, color: 'info',
        })
      ),

      // Charts row 1: outcome + event type
      h('div', { className: 'charts-row' },
        h('div', { className: 'chart-panel' },
          h('div', { ref: outcomeChartRef, style: { width: '100%', minHeight: 260 } })
        ),
        h('div', { className: 'chart-panel' },
          h('div', { ref: eventChartRef, style: { width: '100%', minHeight: 260 } })
        )
      ),

      // Charts row 2: hourly + top users
      h('div', { className: 'charts-row' },
        h('div', { className: 'chart-panel' },
          h('div', { ref: hourlyChartRef, style: { width: '100%', minHeight: 260 } })
        ),
        h('div', { className: 'chart-panel' },
          h('div', { ref: actorChartRef, style: { width: '100%', minHeight: 260 } })
        )
      ),

      // Data table
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, filterLabel ? 'Events \u2014 ' + filterLabel : 'All Login Events'),
          h('div', { className: 'panel-header-actions' },
            filterLabel ? h(Tag, {
              closable: true,
              onClose: function() { setTableFilter(null); },
              color: 'purple',
            }, filterLabel) : null,
            h(Button, {
              size: 'small',
              onClick: function() {
                if (result.csvData) {
                  var ts = dayjs().format('YYYYMMDD_HHmmss');
                  downloadCsv(result.csvData, 'login_audit_' + ts + '.csv');
                } else {
                  var csv = rowsToCsv(filteredRows, result.columns);
                  var ts2 = dayjs().format('YYYYMMDD_HHmmss');
                  downloadCsv(csv, 'login_audit_' + ts2 + '.csv');
                }
              },
            }, 'Export CSV'),
            h(Button, {
              size: 'small',
              loading: pdfLoading2,
              onClick: function() {
                setPdfLoading2(true);
                var dr = dateRange;
                var meta = {
                  generated: dayjs().format('YYYY-MM-DD HH:mm:ss') + ' UTC',
                  records: result.rowCount || filteredRows.length,
                  dateRange: dr && dr[0] && dr[1] ? dr[0].format('YYYY-MM-DD') + ' to ' + dr[1].format('YYYY-MM-DD') : 'N/A',
                  system: 'Keycloak Login Audit',
                };
                downloadPdf(filteredRows, result.columns, meta)
                  .then(function() { setPdfLoading2(false); message.success('PDF downloaded'); })
                  .catch(function(err) { setPdfLoading2(false); message.error(err.message || 'PDF export failed'); });
              },
            }, 'Export PDF')
          )
        ),
        h(Table, {
          dataSource: filteredRows,
          columns: columns,
          rowKey: '_key',
          size: 'small',
          scroll: { x: 'max-content', y: 500 },
          pagination: { pageSize: 50, showSizeChanger: true, showTotal: function(t) { return t + ' rows'; } },
        })
      )
    ) : null,

    result && result.status === 'empty' ? h(Empty, { description: result.message }) : null
  );
}


// ---------------------------------------------------------------------------
// About Panel
// ---------------------------------------------------------------------------
function AboutPanel() {
  return h(Collapse, {
    items: [{
      key: '1',
      label: 'About this App',
      children: h('div', { className: 'about-content' },
        h('p', null, h('strong', null, 'Domino Audit Trail Exporter'), ' allows you to export Domino Audit Trail data into JSON, CSV, and Parquet formats with full metadata flattening.'),
        h('ul', null,
          h('li', null, 'Uses the official Domino Audit Trail API'),
          h('li', null, h('strong', null, 'Login Audit tab'), ' queries Keycloak for login/logout events (21 CFR Part 11 compliance)'),
          h('li', null, 'Tracks successful and failed authentication attempts with IP, session, and user details'),
          h('li', null, 'Data is written to a Domino Dataset you select at runtime'),
          h('li', null, 'Metadata is flattened dynamically \u2014 new Domino fields appear automatically'),
          h('li', null, 'Explore tab queries Parquet files with DuckDB for fast rollups')
        ),
        h('p', { className: 'about-disclaimer' }, 'This is not an official Domino product. Provided as-is without official support.')
      ),
    }],
    style: { marginBottom: 16 },
  });
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  var _config = useState({
    dominoHost: '',
    datasets: [],
    projectOwner: '',
    projectName: '',
    hasApiKey: false,
  });
  var config = _config[0]; var setConfig = _config[1];

  var _connected = useState(false);
  var connected = _connected[0]; var setConnected = _connected[1];

  var _useDummy = useState(true);
  var useDummy = _useDummy[0]; var setUseDummy = _useDummy[1];

  // Fetch config on mount
  useEffect(function() {
    apiGet('api/config')
      .then(function(data) {
        setConfig(data);
        setConnected(true);
        // Stay in dummy mode if no datasets or host detected (not on Domino)
        var onDomino = data.datasets && data.datasets.length > 0 && data.dominoHost;
        setUseDummy(!onDomino);
      })
      .catch(function() {
        setConfig(MOCK_CONFIG);
        setConnected(false);
        setUseDummy(true);
      });
  }, []);

  function handleToggleDummy(checked) {
    setUseDummy(checked);
    if (checked) {
      setConfig(MOCK_CONFIG);
    } else {
      apiGet('api/config')
        .then(function(data) { setConfig(data); })
        .catch(function() {
          message.error('Cannot reach backend. Staying in dummy data mode.');
          setUseDummy(true);
          setConfig(MOCK_CONFIG);
        });
    }
  }

  var projectContext = config.projectOwner && config.projectName
    ? config.projectOwner + '/' + config.projectName : '';

  var effectiveConfig = useDummy ? MOCK_CONFIG : config;

  var tabItems = [
    {
      key: 'export',
      label: 'Export',
      children: h(ExportTab, { config: effectiveConfig, useDummy: useDummy }),
    },
    {
      key: 'explore',
      label: 'Explore',
      children: h(ExploreTab, { config: effectiveConfig, useDummy: useDummy }),
    },
    {
      key: 'login-audit',
      label: 'Login Audit',
      children: h(LoginAuditTab, { config: effectiveConfig, useDummy: useDummy }),
    },
  ];

  return h(ConfigProvider, { theme: dominoTheme },
    h('div', { className: 'app-container' },
      h(TopNav, {
        connected: connected,
        useDummy: useDummy,
        onToggleDummy: handleToggleDummy,
        projectContext: projectContext,
      }),
      h('div', { className: 'app-body' },
        h(AboutPanel),
        h(Tabs, {
          items: tabItems,
          defaultActiveKey: 'export',
          type: 'card',
        })
      )
    )
  );
}

// Mount
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
