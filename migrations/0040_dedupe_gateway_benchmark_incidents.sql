-- Deduplicate historical gateway benchmark incidents.
--
-- Repeated rows with NULL latency and a non-connected status represent one
-- ongoing outage incident. Keep the newest row in each consecutive incident
-- and remove the older duplicates.

WITH ordered AS (
    SELECT
        id,
        heartbeat_latency_ms,
        status,
        recorded_at,
        SUM(
            CASE
                WHEN heartbeat_latency_ms IS NOT NULL OR status = 'connected' THEN 1
                ELSE 0
            END
        ) OVER (
            ORDER BY recorded_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS incident_group
    FROM gateway_benchmarks
),
ranked_unhealthy AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY incident_group
            ORDER BY recorded_at DESC, id DESC
        ) AS unhealthy_rank
    FROM ordered
    WHERE heartbeat_latency_ms IS NULL
      AND status != 'connected'
)
DELETE FROM gateway_benchmarks
WHERE id IN (
    SELECT id
    FROM ranked_unhealthy
    WHERE unhealthy_rank > 1
);