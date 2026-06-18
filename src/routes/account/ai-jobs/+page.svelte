<script lang="ts">
  let { data }: { data: any } = $props();

  const filters = $derived(data.filters || {
    limit: 50,
    offset: 0,
    status: null,
    runnerJobType: null,
    q: "",
    eventLimit: 200,
  });
  const pagination = $derived(
    data.pagination || {
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      hasPrev: false,
      hasNext: false,
      returned: 0,
      loaded: 0,
    }
  );

  function queryHref(next: Record<string, any> = {}) {
    const params = new URLSearchParams();
    const limit = Number(next.limit ?? filters.limit ?? 50) || 50;
    const offset = Math.max(0, Number(next.offset ?? filters.offset ?? 0) || 0);
    const status = String(next.status ?? filters.status ?? "").trim();
    const runnerJobType = String(next.runnerJobType ?? filters.runnerJobType ?? "").trim();
    const q = String(next.q ?? filters.q ?? "").trim();
    const eventLimit = Number(next.eventLimit ?? filters.eventLimit ?? 200) || 200;

    params.set("limit", String(limit));
    params.set("offset", String(offset));
    params.set("eventLimit", String(Math.max(50, Math.min(800, eventLimit))));
    if (status) params.set("status", status);
    if (runnerJobType) params.set("runnerJobType", runnerJobType);
    if (q) params.set("q", q);

    return `?${params.toString()}`;
  }

  function statusClass(status) {
    if (status === "completed") return "badge-success";
    if (status === "running") return "badge-warning";
    if (status === "pending") return "badge-info";
    if (status === "failed_terminal") return "badge-danger";
    if (status === "failed") return "badge-danger";
    if (status === "canceled") return "badge-neutral";
    return "badge-neutral";
  }

  function levelClass(level) {
    if (level === "error") return "badge-danger";
    if (level === "warn") return "badge-warning";
    if (level === "ok") return "badge-success";
    return "badge-info";
  }

  function formatDate(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function truncate(value, len = 120) {
    if (!value || typeof value !== "string") return "";
    if (value.length <= len) return value;
    return `${value.slice(0, len - 1)}...`;
  }

  function formatJson(value) {
    if (value === undefined || value === null) return "-";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function formatDuration(start, end) {
    if (!start || !end) return "-";
    const ms = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(ms) || ms < 0) return "-";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (min < 60) return `${min}m ${rem}s`;
    const hrs = Math.floor(min / 60);
    const minRem = min % 60;
    return `${hrs}h ${minRem}m`;
  }

  function submitClosestForm(event) {
    const form = event.currentTarget?.closest("form");
    form?.requestSubmit();
  }
</script>

<svelte:head>
  <title>Jobs | SpaceBot</title>
</svelte:head>

<div class="container">
  <header class="header">
    <div>
      <h1>Jobs</h1>
      <p class="muted">Forensic view of AI autopilot and local runner activity with status rollups, event stream, and job-level diagnostics.</p>
    </div>
    <div class="header-actions">
      <a class="manage-link" href="/account/ai-workflows">Manage workflows and runners</a>
      <a class="back-link" href="/account">Back to account</a>
    </div>
  </header>

  <section class="ops-callout">
    <div>
      <h3>Operations Console</h3>
      <p class="muted">Use the operations hub to edit workflow routing rules, target specific runners, and tune queue behavior without leaving account settings.</p>
    </div>
    <a class="ops-callout-btn" href="/account/ai-workflows">Open Operations Console</a>
  </section>

  <section class="summary-grid">
    <article class="summary-card">
      <h3>AI Jobs</h3>
      <p class="summary-total">{data.summary?.ai?.total || 0}</p>
      <div class="summary-row">
        <span><strong>{data.summary?.ai?.counts?.running || 0}</strong> running</span>
        <span><strong>{data.summary?.ai?.counts?.pending || 0}</strong> pending</span>
        <span><strong>{data.summary?.ai?.counts?.failed_terminal || 0}</strong> terminal failures</span>
      </div>
    </article>

    <article class="summary-card">
      <h3>Runner Jobs</h3>
      <p class="summary-total">{data.summary?.runner?.total || 0}</p>
      <div class="summary-row">
        <span><strong>{data.summary?.runner?.counts?.running || 0}</strong> running</span>
        <span><strong>{data.summary?.runner?.counts?.failed || 0}</strong> failed</span>
        <span><strong>{data.summary?.runner?.timeoutCount || 0}</strong> timeout-linked</span>
      </div>
    </article>

    <article class="summary-card">
      <h3>Timeline Coverage</h3>
      <p class="summary-total">{data.summary?.timelineCount || 0}</p>
      <div class="summary-row single">
        <span>Latest activity: <strong>{formatDate(data.summary?.latestActivityAt)}</strong></span>
      </div>
    </article>
  </section>

  <form class="filters" method="GET" action="/account/ai-jobs">
    <label>
      AI Status
      <select name="status">
        <option value="" selected={!filters.status}>all</option>
        <option value="pending" selected={filters.status === 'pending'}>pending</option>
        <option value="running" selected={filters.status === 'running'}>running</option>
        <option value="completed" selected={filters.status === 'completed'}>completed</option>
        <option value="failed_terminal" selected={filters.status === 'failed_terminal'}>failed_terminal</option>
        <option value="canceled" selected={filters.status === 'canceled'}>canceled</option>
      </select>
    </label>

    <label class="search">
      Search
      <input
        type="search"
        name="q"
        placeholder="correlation, request, error"
        value={filters.q || ''}
      />
    </label>

    <label>
      Per page
      <select name="limit">
        <option value="25" selected={Number(filters.limit) === 25}>25</option>
        <option value="50" selected={Number(filters.limit) === 50}>50</option>
        <option value="100" selected={Number(filters.limit) === 100}>100</option>
      </select>
    </label>

    <label>
      Timeline depth
      <select name="eventLimit">
        <option value="100" selected={Number(filters.eventLimit) === 100}>100 events</option>
        <option value="200" selected={Number(filters.eventLimit) === 200}>200 events</option>
        <option value="400" selected={Number(filters.eventLimit) === 400}>400 events</option>
        <option value="800" selected={Number(filters.eventLimit) === 800}>800 events</option>
      </select>
    </label>

    <input type="hidden" name="offset" value="0" />
    <button type="submit">Apply</button>
  </form>
  <p class="filters-scope">AI filters control AI table and event stream breadth. Runner type filter controls runner table only.</p>

  <p class="meta">
    Showing {pagination.returned} AI job{pagination.returned === 1 ? '' : 's'}
    {#if filters.q}
      matching "{filters.q}"
    {/if}
    {#if filters.status}
      in status "{filters.status}"
    {/if}
    .
  </p>

  <section class="timeline">
    <div class="section-head">
      <h2>Unified Event Stream</h2>
      <p class="muted">Merged AI and runner events sorted by newest first.</p>
    </div>

    {#if data.timeline?.length}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Domain</th>
              <th>Level</th>
              <th>Type</th>
              <th>Source</th>
              <th>Message</th>
              <th>Ref</th>
            </tr>
          </thead>
          <tbody>
            {#each data.timeline as event}
              <tr>
                <td>{formatDate(event.occurredAt)}</td>
                <td><span class="mono">{event.domain}</span></td>
                <td><span class={`badge ${levelClass(event.level)}`}>{event.level}</span></td>
                <td><span class="mono">{event.type || '-'}</span></td>
                <td>{truncate(event.source || '-', 42)}</td>
                <td>
                  <div>{truncate(event.message || '-', 120)}</div>
                  {#if event.metadata}
                    <details>
                      <summary>metadata</summary>
                      <pre>{formatJson(event.metadata)}</pre>
                    </details>
                  {/if}
                </td>
                <td class="mono">
                  {#if event.correlationId}AI {event.correlationId}{/if}
                  {#if event.aiJobId} #{event.aiJobId}{/if}
                  {#if event.runnerJobId} runner#{event.runnerJobId}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted">No events available for the current scope.</p>
    {/if}
  </section>

  {#if filters.runnerJobType || data.runnerRecentJobs?.length}
    <section class="runner-jobs">
      <div class="section-head">
        <h2>Runner Jobs</h2>
        <p class="muted">Expanded diagnostics include retries, timeout windows, terminal errors, payload/result JSON, and attached runner events.</p>
      </div>
      <div class="runner-jobs-toolbar">
        <form class="runner-type-filter" method="GET" action="/account/ai-jobs">
          <input type="hidden" name="limit" value={filters.limit} />
          <input type="hidden" name="offset" value="0" />
          <input type="hidden" name="eventLimit" value={filters.eventLimit} />
          {#if filters.status}<input type="hidden" name="status" value={filters.status} />{/if}
          {#if filters.q}<input type="hidden" name="q" value={filters.q} />{/if}
          <label>
            Type
            <select name="runnerJobType" onchange={submitClosestForm}>
              <option value="" selected={!filters.runnerJobType}>all</option>
              <option value="screenshot_capture" selected={filters.runnerJobType === 'screenshot_capture'}>screenshot</option>
              <option value="shell_command" selected={filters.runnerJobType === 'shell_command'}>shell</option>
              <option value="system_profile" selected={filters.runnerJobType === 'system_profile'}>profile</option>
              <option value="vscode_discover_instances" selected={filters.runnerJobType === 'vscode_discover_instances'}>vscode_discover</option>
              <option value="vscode_send_copilot_message" selected={filters.runnerJobType === 'vscode_send_copilot_message'}>copilot_msg</option>
            </select>
          </label>
        </form>
        {#if filters.runnerJobType}
          <a class="clear-filter" href={queryHref({ runnerJobType: '', offset: 0 })}>Clear type filter</a>
        {/if}
      </div>
      {#if data.runnerRecentJobs?.length}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Runner</th>
                <th>Timing</th>
                <th>Updated</th>
                <th>Diagnostics</th>
              </tr>
            </thead>
            <tbody>
              {#each data.runnerRecentJobs as job}
                <tr>
                  <td class="mono">#{job.id}</td>
                  <td>{job.jobType}</td>
                  <td><span class={`badge ${statusClass(job.status)}`}>{job.status}</span></td>
                  <td>{job.attemptCount}/{job.maxAttempts}</td>
                  <td>{job.claimedByInstanceName || job.targetInstanceName || '-'}</td>
                  <td>
                    timeout {job.timeoutSeconds || '-'}s
                    {#if job.startedAt && job.completedAt}
                      <div class="muted small">duration {formatDuration(job.startedAt, job.completedAt)}</div>
                    {/if}
                  </td>
                  <td>{formatDate(job.updatedAt)}</td>
                  <td>
                    <div title={job.terminalError || job.command || job.label}>{truncate(job.terminalError || job.label || job.command || '', 100) || '-'}</div>
                    <div class="muted small">next retry {formatDate(job.nextRetryAt)}</div>
                    <div class="muted small">artifacts {job.artifactCount || 0}, exit {job.exitCode ?? '-'}</div>
                    <details>
                      <summary>inspect</summary>
                      <div class="inspect-grid">
                        <div><strong>Command:</strong> {job.command || '-'}</div>
                        <div><strong>Label:</strong> {job.label || '-'}</div>
                        <div><strong>Terminal error:</strong> {job.terminalError || '-'}</div>
                        <div><strong>Output:</strong> {truncate(job.output || '-', 280)}</div>
                        <div><strong>Payload JSON</strong><pre>{formatJson(job.payload)}</pre></div>
                        <div><strong>Result JSON</strong><pre>{formatJson(job.result)}</pre></div>
                        <div><strong>Capabilities</strong><pre>{formatJson(job.capabilityRequirements)}</pre></div>
                        <div>
                          <strong>Runner events ({job.runnerEvents?.length || 0})</strong>
                          {#if job.runnerEvents?.length}
                            {#each job.runnerEvents as event}
                              <div class="event-chip">
                                <span class={`badge ${levelClass(event.level || 'info')}`}>{event.level || 'info'}</span>
                                <span>{formatDate(event.createdAt)} - {event.message || event.eventType}</span>
                              </div>
                            {/each}
                          {:else}
                            <div class="muted small">No recent runner events for this job.</div>
                          {/if}
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">No runner jobs match the selected type.</p>
      {/if}
    </section>
  {/if}

  {#if !data.jobs?.length}
    <div class="empty">No AI autopilot jobs yet.</div>
  {:else}
    <section class="section-head">
      <h2>AI Jobs</h2>
      <p class="muted">Each row includes event counts and latest event context. Expand inspect for raw timeline payload and retry decisions.</p>
    </section>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Correlation</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Latest event</th>
            <th>Request</th>
            <th>Diagnostics</th>
          </tr>
        </thead>
        <tbody>
          {#each data.jobs as job}
            <tr>
              <td class="mono">{job.correlationId}</td>
              <td><span class={`badge ${statusClass(job.status)}`}>{job.status}</span></td>
              <td>{job.attemptCount}/{job.maxAttempts}</td>
              <td>{formatDate(job.createdAt)}</td>
              <td>{formatDate(job.updatedAt)}</td>
              <td>
                <div>{truncate(job.latestEvent?.message || job.latestEvent?.eventType || '-', 72)}</div>
                <div class="muted small">{job.eventCount || 0} event(s)</div>
              </td>
              <td title={job.requestText}>{truncate(job.requestText, 100)}</td>
              <td>
                <div class="diag-links">
                  <a href={`/api/ai/jobs/${job.id}`} target="_blank" rel="noreferrer">raw API</a>
                </div>
                <div class="muted small">next retry {formatDate(job.nextRetryAt)}</div>
                <div class="muted small">completed {formatDate(job.completedAt)}</div>
                {#if job.lastError}
                  <div class="small error-line">{truncate(job.lastError, 150)}</div>
                {/if}
                <details>
                  <summary>inspect</summary>
                  <div class="inspect-grid">
                    <div><strong>Source:</strong> {job.source || '-'}</div>
                    <div><strong>Started:</strong> {formatDate(job.startedAt)}</div>
                    <div><strong>Completed:</strong> {formatDate(job.completedAt)}</div>
                    <div><strong>Duration:</strong> {formatDuration(job.startedAt, job.completedAt)}</div>
                    <div><strong>Last error:</strong> {job.lastError || '-'}</div>
                    <div>
                      <strong>Events ({job.events?.length || 0})</strong>
                      {#if job.events?.length}
                        {#each job.events as event}
                          <details>
                            <summary>{formatDate(event.createdAt)} - {event.eventType}</summary>
                            <div class="muted small">{event.source || '-'} / {event.step || '-'}</div>
                            <div>{event.message || '-'}</div>
                            <pre>{formatJson(event.metadata)}</pre>
                          </details>
                        {/each}
                      {:else}
                        <div class="muted small">No events captured in current window.</div>
                      {/if}
                    </div>
                  </div>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="pager">
      {#if pagination.hasPrev}
        <a class="pager-btn" href={queryHref({ offset: Math.max(0, Number(filters.offset || 0) - Number(filters.limit || 50)) })}>Previous</a>
      {:else}
        <span class="pager-btn disabled">Previous</span>
      {/if}

      {#if pagination.hasNext}
        <a class="pager-btn" href={queryHref({ offset: Number(filters.offset || 0) + Number(filters.limit || 50) })}>Next</a>
      {:else}
        <span class="pager-btn disabled">Next</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header h1 {
    margin: 0;
    font-size: 1.6rem;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .manage-link {
    text-decoration: none;
    color: var(--color-text, #f5f5f5);
    border: 1px solid var(--border-color, #333);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    background: color-mix(in oklab, var(--card-bg, #121019) 80%, #2a1f4f 20%);
  }

  .manage-link:hover {
    border-color: var(--color-primary, #0d6efd);
  }

  .back-link {
    text-decoration: none;
    color: var(--color-primary, #0d6efd);
    font-size: 0.9rem;
  }

  .ops-callout {
    margin-top: 1rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.55rem;
    padding: 0.85rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    background: color-mix(in oklab, var(--card-bg, #121019) 78%, #0f3558 22%);
  }

  .ops-callout h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .ops-callout .muted {
    margin: 0.25rem 0 0;
    font-size: 0.84rem;
  }

  .ops-callout-btn {
    text-decoration: none;
    border: 1px solid var(--color-primary, #0d6efd);
    color: var(--color-primary, #0d6efd);
    border-radius: 0.4rem;
    padding: 0.42rem 0.65rem;
    font-size: 0.84rem;
    white-space: nowrap;
  }

  .filters {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
    align-items: end;
    padding: 0.9rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
  }

  .filters-scope {
    margin: 0.4rem 0 0;
    opacity: 0.7;
    font-size: 0.8rem;
  }

  .filters label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .filters input,
  .filters select,
  .filters button {
    min-height: 2rem;
  }

  .summary-grid {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
  }

  .summary-card {
    border: 1px solid var(--border-color, #333);
    border-radius: 0.55rem;
    padding: 0.8rem;
    background: color-mix(in oklab, var(--card-bg, #121019) 92%, #23203a 8%);
  }

  .summary-card h3 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
  }

  .summary-total {
    margin: 0.35rem 0 0.2rem;
    font-size: 1.4rem;
    font-weight: 700;
  }

  .summary-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.84rem;
    opacity: 0.9;
  }

  .summary-row.single {
    display: block;
  }

  .filters button {
    cursor: pointer;
  }

  .meta {
    margin-top: 0.6rem;
    opacity: 0.75;
    font-size: 0.9rem;
  }

  .muted {
    opacity: 0.75;
    margin-top: 0.25rem;
  }

  .runner-jobs {
    margin-top: 1.25rem;
  }

  .section-head {
    margin-top: 1.25rem;
  }

  .section-head h2,
  .runner-jobs h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }

  .timeline {
    margin-top: 1.2rem;
  }

  .runner-jobs-toolbar {
    margin-bottom: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .runner-type-filter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .runner-type-filter label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .runner-type-filter select {
    min-height: 1.9rem;
  }

  .clear-filter {
    font-size: 0.82rem;
    text-decoration: none;
    color: var(--color-primary, #0d6efd);
  }

  .clear-filter:hover {
    text-decoration: underline;
  }

  .empty {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.5rem;
  }

  .table-wrap {
    margin-top: 1rem;
    overflow-x: auto;
  }

  .pager {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .pager-btn {
    text-decoration: none;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.35rem;
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
  }

  .pager-btn.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 0.6rem;
    border-bottom: 1px solid var(--border-color, #333);
    vertical-align: top;
  }

  .mono {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.85rem;
  }

  .badge {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-size: 0.78rem;
    border: 1px solid transparent;
  }

  .badge-success {
    color: #0f5132;
    background: #d1e7dd;
    border-color: #badbcc;
  }

  .badge-warning {
    color: #664d03;
    background: #fff3cd;
    border-color: #ffecb5;
  }

  .badge-info {
    color: #084298;
    background: #cfe2ff;
    border-color: #b6d4fe;
  }

  .badge-danger {
    color: #842029;
    background: #f8d7da;
    border-color: #f5c2c7;
  }

  .badge-neutral {
    color: var(--color-fixed-text-dark-muted);
    background: #e2e3e5;
    border-color: #d3d6d8;
  }

  .inspect-grid {
    margin-top: 0.45rem;
    display: grid;
    gap: 0.4rem;
  }

  .event-chip {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.3rem;
  }

  .diag-links {
    display: flex;
    gap: 0.5rem;
  }

  .small {
    font-size: 0.8rem;
  }

  .error-line {
    margin-top: 0.2rem;
    color: #f5c2c7;
  }

  pre {
    margin: 0.3rem 0;
    padding: 0.45rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 0.35rem;
    max-height: 180px;
    overflow: auto;
    font-size: 0.74rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  details > summary {
    cursor: pointer;
    font-size: 0.82rem;
  }

  @media (max-width: 900px) {
    .header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      justify-content: flex-start;
    }

    .ops-callout {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
