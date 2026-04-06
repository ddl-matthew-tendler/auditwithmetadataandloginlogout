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
var Modal = antd.Modal;
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
    if (!r.ok) return r.text().then(function(text) {
      try { var e = JSON.parse(text); throw new Error(e.detail || r.statusText); }
      catch(parseErr) { if (parseErr.message && parseErr.message !== r.statusText) throw parseErr; throw new Error(r.status + ': ' + (text.slice(0, 200) || r.statusText)); }
    });
    return r.json();
  });
}

function apiGet(url) {
  return fetch(url).then(function(r) {
    if (!r.ok) return r.text().then(function(text) {
      try { var e = JSON.parse(text); throw new Error(e.detail || r.statusText); }
      catch(parseErr) { if (parseErr.message && parseErr.message !== r.statusText) throw parseErr; throw new Error(r.status + ': ' + (text.slice(0, 200) || r.statusText)); }
    });
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

function downloadPdf(rows, selectedColumns, meta) {
  return fetch('api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: rows, selectedColumns: selectedColumns, meta: meta }),
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

// Human-readable PDF columns matching Domino audit trail UI.
// Order matters — this is the display order in the picker.
// Each entry: { label: display name, key: actual data column name }
var PDF_COLUMN_OPTIONS = [
  { label: 'Date & Time', key: 'Date & Time' },
  { label: 'User Name', key: 'User Name' },
  { label: 'Event', key: 'Event' },
  { label: 'Project Name', key: 'Project' },
  { label: 'Target Name', key: 'Target User' },
  { label: 'Target Type', key: 'Target Entity Type' },
  { label: 'Before Value', key: 'Before' },
  { label: 'After Value', key: 'After' },
  { label: 'Field Changed', key: 'Field Changed' },
  { label: 'Field Type', key: 'Field Type' },
  { label: 'User First Name', key: 'User First Name' },
  { label: 'User Last Name', key: 'User Last Name' },
  { label: 'Added', key: 'Added' },
  { label: 'Removed', key: 'Removed' },
];
var PDF_DEFAULT_LABELS = ['Date & Time', 'User Name', 'Event', 'Project Name', 'Target Name', 'Field Changed'];

// PDF Column Picker Modal component
function PdfColumnPicker(props) {
  var visible = props.visible;
  var onCancel = props.onCancel;
  var onExport = props.onExport;
  var dataColumns = props.columns || [];
  var loading = props.loading;

  // Filter to options that exist in the actual data
  var availableOptions = PDF_COLUMN_OPTIONS.filter(function(opt) {
    return dataColumns.indexOf(opt.key) >= 0;
  });

  var defaultLabels = PDF_DEFAULT_LABELS.filter(function(label) {
    return availableOptions.some(function(opt) { return opt.label === label; });
  });

  var _selected = useState(defaultLabels);
  var selected = _selected[0]; var setSelected = _selected[1];

  // Reset selection when modal opens
  useEffect(function() {
    if (visible) {
      setSelected(defaultLabels.length ? defaultLabels : availableOptions.slice(0, 6).map(function(o) { return o.label; }));
    }
  }, [visible]);

  function toggleCol(label) {
    var idx = selected.indexOf(label);
    if (idx >= 0) {
      setSelected(selected.filter(function(c) { return c !== label; }));
    } else if (selected.length < 6) {
      setSelected(selected.concat([label]));
    } else {
      message.warning('Maximum 6 columns for PDF export');
    }
  }

  function handleExport() {
    // Map selected labels back to data column keys
    var selectedKeys = selected.map(function(label) {
      var opt = availableOptions.find(function(o) { return o.label === label; });
      return opt ? opt.key : label;
    });
    onExport(selectedKeys);
  }

  return h(Modal, {
    title: 'Select PDF Columns (max 6)',
    open: visible,
    onCancel: onCancel,
    maskClosable: false,
    width: 520,
    footer: h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { style: { color: '#8c8c8c', fontSize: 13 } }, selected.length + ' of 6 columns selected'),
      h('div', null,
        h(Button, { onClick: onCancel, style: { marginRight: 8 } }, 'Cancel'),
        h(Button, {
          type: 'primary',
          disabled: selected.length === 0,
          loading: loading,
          onClick: handleExport,
        }, 'Export PDF')
      )
    ),
  },
    h('p', { style: { marginBottom: 12, color: '#65657B' } }, 'Choose which columns to include in the PDF report. Columns will be sized to fit the page.'),
    h('p', { style: { marginBottom: 12, color: '#65657B', fontSize: 12 } }, 'CSV export includes all columns with full metadata.'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
      availableOptions.map(function(opt) {
        var isSelected = selected.indexOf(opt.label) >= 0;
        var orderNum = isSelected ? selected.indexOf(opt.label) + 1 : null;
        return h(Tag, {
          key: opt.label,
          color: isSelected ? 'purple' : 'default',
          style: { cursor: 'pointer', padding: '4px 10px', fontSize: 13, marginBottom: 4 },
          onClick: function(e) { e.stopPropagation(); toggleCol(opt.label); },
        },
          isSelected ? h('span', { style: { marginRight: 4, fontWeight: 'bold' } }, orderNum + '.') : null,
          opt.label
        );
      })
    )
  );
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
// Column builder helper — adds sort + filter to every column
// ---------------------------------------------------------------------------
function buildTableColumns(rows, columnNames) {
  if (!columnNames || !columnNames.length) return [];
  return columnNames.map(function(col) {
    // Collect unique non-null values for filter dropdown (max 50)
    var uniqueVals = {};
    (rows || []).forEach(function(r) {
      var v = r[col];
      if (v != null && v !== '') uniqueVals[String(v)] = true;
    });
    var filterValues = Object.keys(uniqueVals).sort().slice(0, 50);

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
      filters: filterValues.map(function(v) { return { text: v.length > 40 ? v.slice(0, 37) + '...' : v, value: v }; }),
      onFilter: function(value, record) { return String(record[col] || '') === value; },
      filterSearch: filterValues.length > 10,
    };
    if (col === 'Event') {
      cfg.render = function(val) {
        if (!val) return '\u2014';
        return h(Tag, { color: 'purple' }, val);
      };
    }
    return cfg;
  });
}

// ---------------------------------------------------------------------------
// Export Tab
// ---------------------------------------------------------------------------
function ExportTab(props) {
  var config = props.config;
  var useDummy = props.useDummy;

  // Host auto-detected from backend env or browser origin
  var dominoHost = config.dominoHost || window.location.origin;

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

  var _pdfModalOpen = useState(false);
  var pdfModalOpen = _pdfModalOpen[0]; var setPdfModalOpen = _pdfModalOpen[1];

  var _filteredRows = useState(null);
  var filteredRows = _filteredRows[0]; var setFilteredRows = _filteredRows[1];

  function handleExport() {
    if (useDummy) {
      setLoading(true);
      setFilteredRows(null);
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
    setFilteredRows(null);

    var body = {
      dominoHost: dominoHost,
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
          message.success('Export complete: ' + data.rowCount + ' records');
        }
      })
      .catch(function(err) {
        setError(err.message);
        setLoading(false);
      });
  }

  var columns = useMemo(function() {
    return buildTableColumns(result ? result.rows : [], result ? result.columns : []);
  }, [result]);

  var tableData = useMemo(function() {
    if (!result || !result.rows) return [];
    return result.rows.map(function(r, i) {
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
        h(StatCard, {
          label: filteredRows !== null && filteredRows.length !== tableData.length ? 'Showing / Total Records' : 'Total Audit Records',
          value: filteredRows !== null && filteredRows.length !== tableData.length
            ? filteredRows.length.toLocaleString() + ' / ' + tableData.length.toLocaleString()
            : (result.rowCount || 0).toLocaleString(),
          color: filteredRows !== null && filteredRows.length !== tableData.length ? 'info' : 'primary',
        })
      ),

      // Data table with download buttons
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, 'Results'),
          h('div', { className: 'panel-header-actions' },
            h(Button, {
              type: 'primary',
              size: 'small',
              onClick: function() {
                var today = dayjs().format('YYYYMMDD');
                var exportRows = filteredRows !== null && filteredRows.length !== tableData.length ? filteredRows : result.rows;
                var csv = rowsToCsv(exportRows, result.columns);
                var suffix = filteredRows !== null && filteredRows.length !== tableData.length ? '_filtered' : '';
                downloadCsv(csv, 'audit_trail' + suffix + '_' + today + '.csv');
              },
            }, filteredRows !== null && filteredRows.length !== tableData.length ? 'CSV \u2014 All Columns (' + filteredRows.length + ' rows)' : 'CSV \u2014 All Columns'),
            h(Button, {
              size: 'small',
              onClick: function() { setPdfModalOpen(true); },
            }, filteredRows !== null && filteredRows.length !== tableData.length ? 'PDF Report (' + filteredRows.length + ' rows)' : 'PDF Report')
          )
        ),
        h(Table, {
          dataSource: tableData,
          columns: columns,
          rowKey: '_key',
          size: 'small',
          scroll: { x: 'max-content', y: 500 },
          pagination: { pageSize: 50, showSizeChanger: true, showTotal: function(t) { return t + ' rows'; } },
          onChange: function(_pagination, _filters, _sorter, extra) {
            setFilteredRows(extra.currentDataSource);
          },
        })
      ),

      // PDF column picker modal
      h(PdfColumnPicker, {
        visible: pdfModalOpen,
        columns: result ? result.columns : [],
        loading: pdfLoading,
        onCancel: function() { setPdfModalOpen(false); },
        onExport: function(selectedCols) {
          setPdfLoading(true);
          var exportRows = filteredRows !== null && filteredRows.length !== tableData.length ? filteredRows : result.rows;
          var dr = dateRange;
          var meta = {
            generated: dayjs().format('YYYY-MM-DD HH:mm:ss') + ' UTC',
            records: exportRows.length,
            dateRange: dr && dr[0] && dr[1] ? dr[0].format('YYYY-MM-DD') + ' to ' + dr[1].format('YYYY-MM-DD') : 'N/A',
            system: dominoHost || 'Domino',
          };
          downloadPdf(exportRows, selectedCols, meta)
            .then(function() { setPdfLoading(false); setPdfModalOpen(false); message.success('PDF downloaded'); })
            .catch(function(err) { setPdfLoading(false); message.error(err.message || 'PDF export failed'); });
        },
      })
    ) : null
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

  var _pdfModalOpen2 = useState(false);
  var pdfModalOpen2 = _pdfModalOpen2[0]; var setPdfModalOpen2 = _pdfModalOpen2[1];

  var _columnFilteredRows = useState(null);
  var columnFilteredRows = _columnFilteredRows[0]; var setColumnFilteredRows = _columnFilteredRows[1];

  // Keycloak connection diagnostics
  var _kcStatus = useState(null);
  var kcStatus = _kcStatus[0]; var setKcStatus = _kcStatus[1];

  var _kcTesting = useState(false);
  var kcTesting = _kcTesting[0]; var setKcTesting = _kcTesting[1];

  var outcomeChartRef = useRef(null);
  var eventChartRef = useRef(null);
  var hourlyChartRef = useRef(null);
  var actorChartRef = useRef(null);

  var hasKeycloak = config.hasKeycloak;

  function testKeycloakConnection() {
    setKcTesting(true);
    setKcStatus(null);
    apiGet('api/keycloak-status')
      .then(function(data) {
        setKcStatus(data);
        setKcTesting(false);
        if (data.error) {
          message.error('Keycloak: ' + data.error);
        } else {
          message.success('Keycloak connection verified — all checks passed');
        }
      })
      .catch(function(err) {
        setKcStatus({ error: err.message });
        setKcTesting(false);
      });
  }

  function handleFetch() {
    if (useDummy) {
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
        message.success('Loaded ' + (data.eventCount || 0).toLocaleString() + ' login events');
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

  // Build the Keycloak status diagnostic display
  function renderKcDiagnostics() {
    if (!kcStatus) return null;
    var steps = [
      { label: 'KEYCLOAK_PASSWORD set', ok: kcStatus.passwordSet },
      { label: 'Host: ' + (kcStatus.hostExplicit || kcStatus.hostAutoDetected || 'not found'), ok: kcStatus.reachable },
      { label: 'Authentication', ok: kcStatus.authSuccess },
      { label: 'Realm accessible' + (kcStatus.userCount != null ? ' (' + kcStatus.userCount + ' users sampled)' : ''), ok: kcStatus.realmAccessible },
      { label: 'Event query' + (kcStatus.eventSample != null ? ' (' + kcStatus.eventSample + ' sample events)' : ''), ok: kcStatus.eventSample != null },
    ];
    return h('div', { style: { marginTop: 12 } },
      steps.map(function(step, i) {
        var icon = step.ok ? '\u2705' : (kcStatus.error && !step.ok ? '\u274C' : '\u2B1C');
        return h('div', { key: i, style: { fontSize: 13, marginBottom: 2 } }, icon + ' ' + step.label);
      }),
      kcStatus.error ? h('div', { style: { marginTop: 8, padding: '8px 12px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4, fontSize: 13, color: '#C20A29' } }, kcStatus.error) : null,
      !kcStatus.error ? h('div', { style: { marginTop: 8, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, fontSize: 13, color: '#28A464' } }, 'All checks passed — Keycloak is ready.') : null
    );
  }

  return h('div', { className: 'tab-content' },
    // Keycloak not configured warning
    !hasKeycloak && !useDummy ? h(Alert, {
      type: 'warning',
      showIcon: true,
      message: 'Keycloak Not Configured',
      description: h('div', null,
        h('p', { style: { margin: '0 0 8px' } }, 'To enable login/logout audit tracking, you need to set the Keycloak admin password as an environment variable:'),
        h('ol', { style: { margin: 0, paddingLeft: 20 } },
          h('li', null, 'Go to ', h('strong', null, 'Account Settings'), ' → ', h('strong', null, 'User Environment Variables'), ' (left sidebar in the Domino UI)'),
          h('li', null, 'In the ', h('strong', null, 'Set user environment variable'), ' section, enter:', h('ul', { style: { margin: '4px 0', paddingLeft: 20 } },
            h('li', null, 'Name: ', h('code', null, 'KEYCLOAK_PASSWORD')),
            h('li', null, 'Value: the Keycloak ', h('code', null, 'admin'), ' user password (ask your Domino platform administrator if you don\'t know it)')
          )),
          h('li', null, 'Click ', h('strong', null, 'Set variable')),
          h('li', null, h('strong', null, 'Restart this app'), ' — environment variables are only loaded at startup')
        ),
        h('p', { style: { margin: '8px 0 0', color: '#8c8c8c' } }, 'The Keycloak host is auto-detected on Domino deployments. No URL configuration is needed.'),
        h('div', { style: { marginTop: 12 } },
          h(Button, {
            size: 'small',
            loading: kcTesting,
            onClick: testKeycloakConnection,
          }, 'Test Keycloak Connection'),
          renderKcDiagnostics()
        )
      ),
      style: { marginBottom: 16 },
    }) : null,

    // Show test connection option even when hasKeycloak is true (for diagnostics)
    hasKeycloak && !useDummy ? h('div', { style: { marginBottom: 12 } },
      h(Button, {
        size: 'small',
        type: 'default',
        loading: kcTesting,
        onClick: testKeycloakConnection,
        style: { marginRight: 8 },
      }, 'Test Keycloak Connection'),
      kcStatus && !kcStatus.error ? h(Tag, { color: 'green' }, 'Connected') : null,
      kcStatus && kcStatus.error ? h(Tag, { color: 'red' }, 'Error') : null,
      renderKcDiagnostics()
    ) : null,

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
          h(Button, {
            type: 'primary',
            onClick: handleFetch,
            loading: loading,
            disabled: !useDummy && !hasKeycloak,
          }, !useDummy && !hasKeycloak ? 'Keycloak Not Configured' : 'Fetch Login Events')
        )
      )
    ),

    error ? h(Alert, { type: 'error', message: error, showIcon: true, closable: true, onClose: function() { setError(null); }, style: { marginBottom: 16 } }) : null,
    loading ? h('div', { className: 'loading-container' }, h(Spin, { size: 'large' }), h('p', null, 'Querying Keycloak events...')) : null,

    result && result.status === 'ok' ? h('div', null,
      // Stats row
      h('div', { className: 'stats-row' },
        h(StatCard, {
          label: columnFilteredRows !== null && columnFilteredRows.length !== filteredRows.length ? 'Showing / Total Events' : 'Total Events',
          value: columnFilteredRows !== null && columnFilteredRows.length !== filteredRows.length
            ? columnFilteredRows.length.toLocaleString() + ' / ' + (result.eventCount || 0).toLocaleString()
            : (result.eventCount || 0).toLocaleString(),
          color: columnFilteredRows !== null && columnFilteredRows.length !== filteredRows.length ? 'info' : 'primary',
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
            (function() {
              var exportRows = columnFilteredRows !== null && columnFilteredRows.length !== filteredRows.length ? columnFilteredRows : filteredRows;
              var isFiltered = exportRows.length !== filteredRows.length;
              return [
                h(Button, {
                  key: 'csv',
                  size: 'small',
                  onClick: function() {
                    var csv = rowsToCsv(exportRows, result.columns);
                    var ts = dayjs().format('YYYYMMDD_HHmmss');
                    var suffix = isFiltered ? '_filtered' : '';
                    downloadCsv(csv, 'login_audit' + suffix + '_' + ts + '.csv');
                  },
                }, isFiltered ? 'CSV \u2014 All Columns (' + exportRows.length + ' rows)' : 'CSV \u2014 All Columns'),
                h(Button, {
                  key: 'pdf',
                  size: 'small',
                  onClick: function() { setPdfModalOpen2(true); },
                }, isFiltered ? 'PDF Report (' + exportRows.length + ' rows)' : 'PDF Report'),
              ];
            })()
          )
        ),
        h(Table, {
          dataSource: filteredRows,
          columns: columns,
          rowKey: '_key',
          size: 'small',
          scroll: { x: 'max-content', y: 500 },
          pagination: { pageSize: 50, showSizeChanger: true, showTotal: function(t) { return t + ' rows'; } },
          onChange: function(_pagination, _filters, _sorter, extra) {
            setColumnFilteredRows(extra.currentDataSource);
          },
        })
      ),

      // PDF column picker modal
      h(PdfColumnPicker, {
        visible: pdfModalOpen2,
        columns: result ? result.columns : [],
        loading: pdfLoading2,
        onCancel: function() { setPdfModalOpen2(false); },
        onExport: function(selectedCols) {
          setPdfLoading2(true);
          var exportRows = columnFilteredRows !== null && columnFilteredRows.length !== filteredRows.length ? columnFilteredRows : filteredRows;
          var dr = dateRange;
          var meta = {
            generated: dayjs().format('YYYY-MM-DD HH:mm:ss') + ' UTC',
            records: exportRows.length,
            dateRange: dr && dr[0] && dr[1] ? dr[0].format('YYYY-MM-DD') + ' to ' + dr[1].format('YYYY-MM-DD') : 'N/A',
            system: 'Keycloak Login Audit',
          };
          downloadPdf(exportRows, selectedCols, meta)
            .then(function() { setPdfLoading2(false); setPdfModalOpen2(false); message.success('PDF downloaded'); })
            .catch(function(err) { setPdfLoading2(false); message.error(err.message || 'PDF export failed'); });
        },
      })
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
          h('li', null, 'Export data as CSV or 21 CFR Part 11 compliant PDF reports'),
          h('li', null, 'Metadata is flattened dynamically \u2014 new Domino fields appear automatically')
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
        // Auto-fill host from browser origin if backend didn't detect one
        if (!data.dominoHost) {
          data.dominoHost = window.location.origin;
        }
        setConfig(data);
        setConnected(true);
        // Stay in dummy mode if no API key (not on Domino)
        setUseDummy(!data.hasApiKey);
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
