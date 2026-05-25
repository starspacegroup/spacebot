<script>
  let { data } = $props();

  const filters = $derived(data.filters || { limit: 50, offset: 0, status: null, q: "" });
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

  function queryHref(next = {}) {
    const params = new URLSearchParams();
    const limit = Number(next.limit ?? filters.limit ?? 50) || 50;
    const offset = Math.max(0, Number(next.offset ?? filters.offset ?? 0) || 0);
    const status = String(next.status ?? filters.status ?? "").trim();
    const q = String(next.q ?? filters.q ?? "").trim();

    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (status) params.set("status", status);
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
</script>

<svelte:head>
  <title>AI Jobs | SpaceBot</title>
</svelte:head>

<div class="container">
  <header class="header">
    <div>
      <h1>AI Jobs</h1>
      <p class="muted">Autopilot timeline and terminal outcomes for your async requests.</p>
      <p class="scope-note">Note: this page now also shows local runner DM and screenshot jobs for easier debugging.</p>
    </div>
    <a class="back-link" href="/account">Back to account</a>
  </header>

  <form class="filters" method="GET" action="/account/ai-jobs">
    <label>
      Status
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

    <input type="hidden" name="offset" value="0" />
    <button type="submit">Apply</button>
  </form>

  <p class="meta">
    Showing {pagination.returned} job{pagination.returned === 1 ? '' : 's'}
    {#if filters.q}
      matching "{filters.q}"
    {/if}
    {#if filters.status}
      in status "{filters.status}"
    {/if}
    .
  </p>

  {#if data.runnerRecentJobs?.length}
    <section class="runner-jobs">
      <h2>Local Runner Jobs</h2>
      <p class="muted">These are local-runner tasks (including screenshot captures) and are separate from autopilot queue jobs.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Runner</th>
              <th>Updated</th>
              <th>Details</th>
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
                <td>{formatDate(job.updatedAt)}</td>
                <td title={job.terminalError || job.command || job.label}>{truncate(job.terminalError || job.label || job.command || '', 100) || '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if !data.jobs?.length}
    <div class="empty">No AI jobs yet.</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Correlation</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Request</th>
            <th>Timeline</th>
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
              <td title={job.requestText}>{truncate(job.requestText, 100)}</td>
              <td><a href={`/api/ai/jobs/${job.id}`} target="_blank" rel="noreferrer">open</a></td>
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

  .back-link {
    text-decoration: none;
    color: var(--color-primary, #0d6efd);
    font-size: 0.9rem;
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

  .scope-note {
    opacity: 0.8;
    margin-top: 0.35rem;
    font-size: 0.9rem;
  }

  .runner-jobs {
    margin-top: 1.25rem;
  }

  .runner-jobs h2 {
    margin: 0 0 0.35rem;
    font-size: 1.1rem;
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
    color: #41464b;
    background: #e2e3e5;
    border-color: #d3d6d8;
  }
</style>
