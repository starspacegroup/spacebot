/**
 * Server-side SVG generation for stats widget images.
 * 
 * Produces self-contained SVG strings that visually match the dashboard
 * chart cards (dark background, area/bar charts, stat headers). Designed
 * to be converted to PNG via resvg-wasm for use in Discord embeds.
 */

const WIDGET_WIDTH = 800;
const WIDGET_HEIGHT = 420;
const PADDING = 28;
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

// Chart area within the widget
const CHART = {
  left: PADDING + 50,   // room for Y-axis labels
  right: WIDGET_WIDTH - PADDING,
  top: 160,
  bottom: 375,
  labelsY: 395,
};
const CHART_W = CHART.right - CHART.left;
const CHART_H = CHART.bottom - CHART.top;

// ----- helpers -----

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAxisValue(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toString();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

// ----- SVG building blocks -----

function svgDefs(gradientId, color) {
  return `
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.4"/>
      <stop offset="50%" stop-color="${color}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${WIDGET_WIDTH}" height="${WIDGET_HEIGHT}" rx="16" ry="16"/>
    </clipPath>
  </defs>`;
}

function svgBackground() {
  return `<rect width="${WIDGET_WIDTH}" height="${WIDGET_HEIGHT}" fill="#1e1e1e" rx="16" ry="16"/>`;
}

function svgHeader(title, stats, color) {
  // Title at top
  let svg = `<text x="${PADDING}" y="${PADDING + 24}" fill="#ffffff" font-size="18" font-weight="600" font-family="${FONT}">${esc(title)}</text>`;

  // Stats row
  if (stats && stats.length > 0) {
    let xOffset = PADDING;
    for (const stat of stats) {
      const statColor = stat.color || color || '#ffffff';
      svg += `<text x="${xOffset}" y="${PADDING + 68}" fill="${statColor}" font-size="36" font-weight="700" font-family="${FONT}">${esc(String(stat.value))}</text>`;
      svg += `<text x="${xOffset}" y="${PADDING + 88}" fill="rgba(255,255,255,0.5)" font-size="11" font-weight="600" font-family="${FONT}" letter-spacing="0.5">${esc(stat.label.toUpperCase())}</text>`;
      xOffset += 200; // spacing between stat columns
    }
  }

  // Divider
  svg += `<line x1="${PADDING}" y1="140" x2="${WIDGET_WIDTH - PADDING}" y2="140" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;

  return svg;
}

function svgAreaChart(data, color, gradientId, unit) {
  if (!data || data.length === 0) {
    return `<text x="${WIDGET_WIDTH / 2}" y="${(CHART.top + CHART.bottom) / 2}" fill="rgba(255,255,255,0.4)" font-size="14" font-family="${FONT}" text-anchor="middle">No data available</text>`;
  }

  const values = data.map(d => d.value || 0);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;

  const xStep = CHART_W / Math.max(data.length - 1, 1);

  // Calculate point positions
  const points = data.map((d, i) => {
    const x = CHART.left + i * xStep;
    const normalized = (d.value - minValue) / range;
    const y = CHART.bottom - normalized * CHART_H;
    return { ...d, x, y };
  });

  let svg = '';

  // Grid lines (5 horizontal)
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  for (const tick of ticks) {
    const y = CHART.bottom - tick * CHART_H;
    const val = minValue + range * tick;
    svg += `<line x1="${CHART.left}" y1="${y}" x2="${CHART.right}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4 4"/>`;
    svg += `<text x="${CHART.left - 8}" y="${y + 4}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="${FONT}" text-anchor="end">${formatAxisValue(val)}${unit}</text>`;
  }

  // Build line path
  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    linePath += ` L ${points[i].x} ${points[i].y}`;
  }

  // Area path (closed shape under the line)
  const areaPath = `M ${CHART.left} ${CHART.bottom} L ${points[0].x} ${points[0].y}` +
    linePath.replace(/^M\s+\S+\s+\S+/, '') +
    ` L ${points[points.length - 1].x} ${CHART.bottom} Z`;

  // Area fill
  svg += `<path d="${areaPath}" fill="url(#${gradientId})"/>`;

  // Line with glow
  svg += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>`;

  // Data points
  for (const pt of points) {
    svg += `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="${color}" opacity="0.3"/>`;
    svg += `<circle cx="${pt.x}" cy="${pt.y}" r="3.5" fill="${color}" stroke="#1e1e1e" stroke-width="2"/>`;
  }

  // X-axis labels (show ~7 max)
  const labelInterval = Math.max(1, Math.ceil(data.length / 7));
  for (let i = 0; i < points.length; i++) {
    if (i === 0 || i === points.length - 1 || i % labelInterval === 0) {
      const label = points[i].label || formatDate(points[i].date);
      svg += `<text x="${points[i].x}" y="${CHART.labelsY}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="${FONT}" text-anchor="middle">${esc(label)}</text>`;
    }
  }

  return svg;
}

function svgBarChart(data, title) {
  if (!data || data.length === 0) {
    return `<text x="${WIDGET_WIDTH / 2}" y="${(CHART.top + CHART.bottom) / 2}" fill="rgba(255,255,255,0.4)" font-size="14" font-family="${FONT}" text-anchor="middle">No data available</text>`;
  }

  const allValues = data.flatMap(d => d.values.map(v => v.value));
  const maxValue = Math.max(...allValues, 1);

  const barGroupWidth = CHART_W / data.length;
  const barWidth = Math.min(barGroupWidth * 0.35, 20);
  const barsPerGroup = data[0]?.values?.length || 1;
  const totalBarWidth = barWidth * barsPerGroup + (barsPerGroup - 1) * 2;

  let svg = '';

  // Grid lines
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  for (const tick of ticks) {
    const y = CHART.bottom - tick * CHART_H;
    const val = maxValue * tick;
    svg += `<line x1="${CHART.left}" y1="${y}" x2="${CHART.right}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4 4"/>`;
    svg += `<text x="${CHART.left - 8}" y="${y + 4}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="${FONT}" text-anchor="end">${formatAxisValue(val)}</text>`;
  }

  // Bars
  const labelInterval = Math.max(1, Math.ceil(data.length / 7));
  for (let i = 0; i < data.length; i++) {
    const group = data[i];
    const groupX = CHART.left + i * barGroupWidth + barGroupWidth / 2;

    for (let j = 0; j < group.values.length; j++) {
      const v = group.values[j];
      const barH = (v.value / maxValue) * CHART_H;
      const barX = groupX - totalBarWidth / 2 + j * (barWidth + 2);
      const barY = CHART.bottom - barH;
      svg += `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barH}" fill="${v.color}" rx="2" ry="2" opacity="0.85"/>`;
    }

    // X labels
    if (i === 0 || i === data.length - 1 || i % labelInterval === 0) {
      svg += `<text x="${groupX}" y="${CHART.labelsY}" fill="rgba(255,255,255,0.4)" font-size="10" font-family="${FONT}" text-anchor="middle">${esc(group.label || formatDate(group.date))}</text>`;
    }
  }

  return svg;
}

// ----- public widget generators -----

/**
 * Generate a Voice Time widget SVG.
 * @param {Array} chartData - from getVoiceActivityChart()
 * @returns {string} Complete SVG string
 */
export function voiceTimeWidget(chartData) {
  const points = chartData || [];
  const totalMinutes = points.reduce((sum, p) => sum + (p.totalMinutes || 0), 0);
  const totalHours = Math.round(totalMinutes / 60 * 10) / 10;
  const useHours = totalMinutes > 120;

  const displayValue = useHours ? totalHours.toFixed(1) : totalMinutes;
  const displayLabel = useHours ? 'Total Hours' : 'Total Minutes';
  const unit = useHours ? 'h' : 'm';
  const color = '#FEE75C';

  const data = points.map(p => ({
    date: p.date,
    value: useHours ? (p.totalHours || 0) : (p.totalMinutes || 0),
  }));

  return wrapSvg([
    svgDefs('voiceGrad', color),
    svgBackground(),
    svgHeader('Voice Time', [{ value: displayValue, label: displayLabel, color }], color),
    svgAreaChart(data, color, 'voiceGrad', unit),
  ]);
}

/**
 * Generate a Member Count widget SVG.
 * @param {number} currentCount - current member count
 * @param {Array} growthData - from getMemberGrowthChart() 
 * @returns {string} Complete SVG string
 */
export function memberCountWidget(currentCount, growthData) {
  const color = '#5865F2';
  const points = growthData || [];

  // Derive member count history from current count + daily net changes
  let data = [];
  if (currentCount > 0 && points.length > 0) {
    const totalNetChange = points.reduce((sum, d) => sum + (d.netChange || 0), 0);
    let running = currentCount - totalNetChange;
    data = points.map(d => {
      running += (d.netChange || 0);
      return { date: d.date, value: running };
    });
  } else if (currentCount > 0) {
    data = [{ date: new Date().toISOString().slice(0, 10), value: currentCount }];
  }

  return wrapSvg([
    svgDefs('memberGrad', color),
    svgBackground(),
    svgHeader('Members', [{ value: formatNumber(currentCount || 0), label: 'Current Members', color }], color),
    svgAreaChart(data, color, 'memberGrad', ''),
  ]);
}

/**
 * Generate a Member Growth widget SVG (bar chart of joins/leaves).
 * @param {Array} growthData - from getMemberGrowthChart()
 * @returns {string} Complete SVG string
 */
export function memberGrowthWidget(growthData) {
  const points = growthData || [];
  const totalJoins = points.reduce((sum, p) => sum + (p.joins || 0), 0);
  const totalLeaves = points.reduce((sum, p) => sum + (p.leaves || 0), 0);
  const netChange = totalJoins - totalLeaves;

  const joinColor = '#22c55e';
  const leaveColor = '#ef4444';

  const barData = points.map(p => ({
    date: p.date,
    values: [
      { value: p.joins || 0, color: joinColor },
      { value: p.leaves || 0, color: leaveColor },
    ],
  }));

  const netColor = netChange > 0 ? joinColor : netChange < 0 ? leaveColor : '#ffffff';
  const netPrefix = netChange > 0 ? '+' : '';

  return wrapSvg([
    svgDefs('growthGrad', joinColor),
    svgBackground(),
    svgHeader('Member Growth', [
      { value: `+${formatNumber(totalJoins)}`, label: 'Joined', color: joinColor },
      { value: `-${formatNumber(totalLeaves)}`, label: 'Left', color: leaveColor },
      { value: `${netPrefix}${formatNumber(netChange)}`, label: 'Net Change', color: netColor },
    ], joinColor),
    svgBarChart(barData, 'Member Growth'),
    // Legend
    `<rect x="${WIDGET_WIDTH - PADDING - 160}" y="${CHART.labelsY - 6}" width="10" height="10" rx="2" fill="${joinColor}"/>` +
    `<text x="${WIDGET_WIDTH - PADDING - 145}" y="${CHART.labelsY + 3}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="${FONT}">Joined</text>` +
    `<rect x="${WIDGET_WIDTH - PADDING - 85}" y="${CHART.labelsY - 6}" width="10" height="10" rx="2" fill="${leaveColor}"/>` +
    `<text x="${WIDGET_WIDTH - PADDING - 70}" y="${CHART.labelsY + 3}" fill="rgba(255,255,255,0.5)" font-size="10" font-family="${FONT}">Left</text>`,
  ]);
}

/**
 * Generate a widget SVG for any supported type.
 * @param {string} type - Widget type: voice_time, member_count, member_growth
 * @param {Object} data - Stats data object  
 * @returns {string} Complete SVG string
 */
export function generateWidget(type, data) {
  switch (type) {
    case 'voice_time':
      return voiceTimeWidget(data.voiceActivityChartData);
    case 'member_count':
      return memberCountWidget(data.currentMemberCount, data.memberGrowthChartData);
    case 'member_growth':
      return memberGrowthWidget(data.memberGrowthChartData);
    default:
      return voiceTimeWidget(data.voiceActivityChartData);
  }
}

/** Wrap SVG content fragments into a complete SVG document.
 * The first fragment is expected to be the <defs> block. */
function wrapSvg(fragments) {
  const [defs, ...content] = fragments;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDGET_WIDTH}" height="${WIDGET_HEIGHT}" viewBox="0 0 ${WIDGET_WIDTH} ${WIDGET_HEIGHT}">
  ${defs}
  <g clip-path="url(#cardClip)">
    ${content.join('\n    ')}
  </g>
</svg>`;
}

/** Available widget types and their display names */
export const WIDGET_TYPES = {
  voice_time: { name: 'Voice Time', description: 'Voice channel activity over time' },
  member_count: { name: 'Member Count', description: 'Total members over time' },
  member_growth: { name: 'Member Growth', description: 'Daily joins and leaves' },
};

/**
 * Generate an HMAC signature for a widget URL.
 * @param {string} guildId
 * @param {string} type - Widget type
 * @param {string} period - Time period
 * @param {number} timestamp - Unix timestamp
 * @param {string} secret - Signing secret (e.g. DISCORD_PUBLIC_KEY)
 * @returns {Promise<string>} Hex-encoded HMAC signature
 */
export async function signWidgetUrl(guildId, type, period, timestamp, secret) {
  const message = `${guildId}|${type}|${period}|${timestamp}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
