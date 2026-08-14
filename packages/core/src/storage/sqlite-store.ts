import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { Event } from "../event-model/event.schema.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  trace_id      TEXT,
  request_id    TEXT,
  service       TEXT NOT NULL,
  host          TEXT,
  container     TEXT,
  deployment_id TEXT,
  timestamp     TEXT NOT NULL,
  duration_ms   REAL,
  attributes    TEXT NOT NULL,
  severity      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id   ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_service    ON events(service);
CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_deployment ON events(deployment_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
`;

export interface EventRow {
  id: string;
  type: string;
  trace_id: string | null;
  request_id: string | null;
  service: string;
  host: string | null;
  container: string | null;
  deployment_id: string | null;
  timestamp: string;
  duration_ms: number | null;
  attributes: string;
  severity: string | null;
}

export interface ServiceSummary {
  service: string;
  event_count: number;
  last_seen: string;
  error_count: number;
}

export class SqliteStore {
  private db: DatabaseType;

  constructor(dbPath: string = "obyflow.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  insert(event: Event): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, trace_id, request_id, service, host, container,
        deployment_id, timestamp, duration_ms, attributes, severity
      ) VALUES (
        @id, @type, @trace_id, @request_id, @service, @host, @container,
        @deployment_id, @timestamp, @duration_ms, @attributes, @severity
      )
    `);
    stmt.run({
      ...event,
      attributes: JSON.stringify(event.attributes),
    });
  }

  insertMany(events: Event[]): void {
    const insertOne = this.db.prepare(`
      INSERT INTO events (
        id, type, trace_id, request_id, service, host, container,
        deployment_id, timestamp, duration_ms, attributes, severity
      ) VALUES (
        @id, @type, @trace_id, @request_id, @service, @host, @container,
        @deployment_id, @timestamp, @duration_ms, @attributes, @severity
      )
    `);
    const runAll = this.db.transaction((rows: Event[]) => {
      for (const e of rows) {
        insertOne.run({ ...e, attributes: JSON.stringify(e.attributes) });
      }
    });
    runAll(events);
  }

  getByTraceId(traceId: string): EventRow[] {
    return this.db
      .prepare(`SELECT * FROM events WHERE trace_id = ? ORDER BY timestamp ASC`)
      .all(traceId) as EventRow[];
  }

  getByService(service: string, sinceIso?: string): EventRow[] {
    if (sinceIso) {
      return this.db
        .prepare(
          `SELECT * FROM events WHERE service = ? AND timestamp >= ? ORDER BY timestamp ASC`,
        )
        .all(service, sinceIso) as EventRow[];
    }
    return this.db
      .prepare(`SELECT * FROM events WHERE service = ? ORDER BY timestamp ASC`)
      .all(service) as EventRow[];
  }

  getRecent(filter: {
    type?: string;
    service?: string;
    sinceIso?: string;
    limit?: number;
  } = {}): EventRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }
    if (filter.service) {
      conditions.push("service = ?");
      params.push(filter.service);
    }
    if (filter.sinceIso) {
      conditions.push("timestamp >= ?");
      params.push(filter.sinceIso);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 50;

    return this.db
      .prepare(
        `SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(...params, limit) as EventRow[];
  }

  getErrors(filter: {
    service?: string;
    sinceIso?: string;
    limit?: number;
  } = {}): EventRow[] {
    const conditions: string[] = ["severity IN ('error', 'critical')"];
    const params: unknown[] = [];

    if (filter.service) {
      conditions.push("service = ?");
      params.push(filter.service);
    }
    if (filter.sinceIso) {
      conditions.push("timestamp >= ?");
      params.push(filter.sinceIso);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = filter.limit ?? 50;

    return this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params, limit) as EventRow[];
  }

  getServices(): ServiceSummary[] {
    return this.db
      .prepare(
        `SELECT
           service,
           COUNT(*) as event_count,
           MAX(timestamp) as last_seen,
           SUM(CASE WHEN severity IN ('error', 'critical') THEN 1 ELSE 0 END) as error_count
         FROM events
         GROUP BY service
         ORDER BY last_seen DESC`,
      )
      .all() as ServiceSummary[];
  }

  close(): void {
    this.db.close();
  }
}

export function rowToEvent(row: EventRow): Event {
  return {
    ...row,
    duration_ms: row.duration_ms,
    attributes: JSON.parse(row.attributes),
  } as Event;
}