<script>
  let { data } = $props();

  function statusClass(status) {
    if (status === "completed") return "badge-success";
    if (status === "running") return "badge-warning";
    if (status === "failed_terminal") return "badge-danger";
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
    <h1>AI Jobs</h1>
    <p class="muted">Autopilot timeline and terminal outcomes for your async requests.</p>
  </header>

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

  .muted {
    opacity: 0.75;
    margin-top: 0.25rem;
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
