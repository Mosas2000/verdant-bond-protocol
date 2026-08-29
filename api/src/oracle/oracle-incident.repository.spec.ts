import { randomUUID } from 'crypto';
import { spawn, ChildProcessByStdio } from 'child_process';
import * as path from 'path';
import { Readable } from 'stream';
import { OracleIncidentRepository } from './oracle-incident.repository';
import {
  OracleIncidentSeverity,
  OracleIncidentStatus,
  OracleIncidentSubjectType,
} from './interfaces/oracle-incident.interface';

/**
 * Integration test for OracleIncidentRepository (issue #95), run against a
 * real, ephemeral PostgreSQL server -- not a mock or a SQL emulator. This
 * matters because the dedup/recurrence guarantee relies on a real
 * PostgreSQL-specific feature (a partial unique index combined with
 * `INSERT ... ON CONFLICT (col) WHERE <predicate> DO UPDATE`); a
 * lighter-weight in-memory SQL engine (`pg-mem` was evaluated and does not
 * parse this exact clause) would not actually verify that this works. The
 * CI workflow (`.github/workflows/ci.yml`) does not provision a Postgres
 * service for the `api` job, so this test brings its own real, disposable
 * database instead of depending on one being externally available.
 *
 * The database itself is started by `test-setup/embedded-postgres-server.mjs`
 * in a genuinely separate `node` child process, not loaded in-process. The
 * `embedded-postgres` npm package ships as pure ESM with no CommonJS build,
 * and this project's Jest is configured for CommonJS/ts-jest (matching every
 * other test file); Jest's sandboxed module loader cannot execute a real ESM
 * package even via a dynamic `import()` from inside a test file. Running it
 * as a plain `node file.mjs` subprocess sidesteps that entirely -- Jest is
 * not involved in loading it at all.
 */

const PORT = 57432;
let serverProcess: ChildProcessByStdio<null, Readable, Readable>;
let repository: OracleIncidentRepository;

jest.setTimeout(60_000);

function startEmbeddedPostgres(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, '..', '..', 'test-setup', 'embedded-postgres-server.mjs'), String(PORT)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    serverProcess = child;

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`embedded-postgres-server exited early (code ${code}): ${stderr}`));
      }
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/PGREADY:(\S+)/);
      if (match) resolve(match[1]);
    });
  });
}

function stopEmbeddedPostgres(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.exitCode !== null) {
      resolve();
      return;
    }
    serverProcess.once('exit', () => resolve());
    serverProcess.kill('SIGTERM');
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = await startEmbeddedPostgres();
  process.env.ORACLE_INCIDENT_ESCALATION_THRESHOLDS = '3:critical';

  repository = new OracleIncidentRepository();
  await repository.onModuleInit();
});

afterAll(async () => {
  await repository.onModuleDestroy();
  await stopEmbeddedPostgres();
});

function detection(overrides: Partial<{ subjectType: OracleIncidentSubjectType; subjectId: string; detectedAt: string }> = {}) {
  return {
    subjectType: overrides.subjectType ?? OracleIncidentSubjectType.Project,
    subjectId: overrides.subjectId ?? randomUUID(),
    detectedAt: overrides.detectedAt ?? '2026-01-01T00:00:00.000Z',
    details: { lastVerifiedAt: '2025-12-01T00:00:00.000Z', stalenessSeconds: 2_592_000 },
  };
}

describe('OracleIncidentRepository', () => {
  describe('creation', () => {
    it('creates a new active incident on first detection', async () => {
      const input = detection();
      const result = await repository.recordDetection(input);

      expect(result.isNew).toBe(true);
      expect(result.escalated).toBe(false);
      expect(result.incident.status).toBe(OracleIncidentStatus.Active);
      expect(result.incident.severity).toBe(OracleIncidentSeverity.Warning);
      expect(result.incident.occurrenceCount).toBe(1);
      expect(result.incident.subjectId).toBe(input.subjectId);
      expect(result.incident.dedupeKey).toBe(`project:${input.subjectId}`);
    });

    it('keys projects and providers separately even with the same subject id', async () => {
      const subjectId = randomUUID();
      const project = await repository.recordDetection(
        detection({ subjectType: OracleIncidentSubjectType.Project, subjectId }),
      );
      const provider = await repository.recordDetection(
        detection({ subjectType: OracleIncidentSubjectType.Provider, subjectId }),
      );

      expect(project.isNew).toBe(true);
      expect(provider.isNew).toBe(true);
      expect(project.incident.id).not.toBe(provider.incident.id);
    });
  });

  describe('dedupe', () => {
    it('updates the existing incident instead of creating a new row on a repeated cron cycle', async () => {
      const subjectId = randomUUID();
      const first = await repository.recordDetection(detection({ subjectId, detectedAt: '2026-01-01T00:00:00.000Z' }));
      const second = await repository.recordDetection(detection({ subjectId, detectedAt: '2026-01-02T00:00:00.000Z' }));

      expect(second.isNew).toBe(false);
      expect(second.incident.id).toBe(first.incident.id);
      expect(second.incident.occurrenceCount).toBe(2);
      expect(second.incident.lastDetectedAt).toBe('2026-01-02T00:00:00.000Z');

      const listed = await repository.findMany(1, 20, undefined);
      const matching = listed.data.filter((incident) => incident.dedupeKey === first.incident.dedupeKey);
      expect(matching).toHaveLength(1);
    });

    it('is safe under concurrent detections for the same subject (no duplicate active rows)', async () => {
      const subjectId = randomUUID();
      const [a, b, c] = await Promise.all([
        repository.recordDetection(detection({ subjectId, detectedAt: '2026-02-01T00:00:00.000Z' })),
        repository.recordDetection(detection({ subjectId, detectedAt: '2026-02-01T00:00:01.000Z' })),
        repository.recordDetection(detection({ subjectId, detectedAt: '2026-02-01T00:00:02.000Z' })),
      ]);

      const ids = new Set([a.incident.id, b.incident.id, c.incident.id]);
      expect(ids.size).toBe(1);
      const finalCount = Math.max(a.incident.occurrenceCount, b.incident.occurrenceCount, c.incident.occurrenceCount);
      expect(finalCount).toBe(3);
    });
  });

  describe('escalation', () => {
    it('escalates severity once occurrence count reaches the configured threshold', async () => {
      const subjectId = randomUUID();
      const first = await repository.recordDetection(detection({ subjectId }));
      expect(first.incident.severity).toBe(OracleIncidentSeverity.Warning);

      const second = await repository.recordDetection(detection({ subjectId }));
      expect(second.escalated).toBe(false);
      expect(second.incident.severity).toBe(OracleIncidentSeverity.Warning);

      // ORACLE_INCIDENT_ESCALATION_THRESHOLDS='3:critical' set in beforeAll.
      const third = await repository.recordDetection(detection({ subjectId }));
      expect(third.escalated).toBe(true);
      expect(third.incident.severity).toBe(OracleIncidentSeverity.Critical);
      expect(third.incident.occurrenceCount).toBe(3);

      // Does not re-fire "escalated" once already at the target severity.
      const fourth = await repository.recordDetection(detection({ subjectId }));
      expect(fourth.escalated).toBe(false);
      expect(fourth.incident.severity).toBe(OracleIncidentSeverity.Critical);
    });
  });

  describe('acknowledgement', () => {
    it('acknowledges an active incident', async () => {
      const { incident } = await repository.recordDetection(detection());
      const acknowledged = await repository.acknowledge(incident.id, 'GADMIN...OPERATOR');

      expect(acknowledged.status).toBe(OracleIncidentStatus.Acknowledged);
      expect(acknowledged.acknowledgedBy).toBe('GADMIN...OPERATOR');
      expect(acknowledged.acknowledgedAt).not.toBeNull();
    });

    it('rejects acknowledging an incident that is already acknowledged', async () => {
      const { incident } = await repository.recordDetection(detection());
      await repository.acknowledge(incident.id, 'GADMIN...OPERATOR');

      await expect(repository.acknowledge(incident.id, 'GADMIN...OPERATOR')).rejects.toThrow();
    });

    it('rejects acknowledging a resolved incident', async () => {
      const { incident } = await repository.recordDetection(detection());
      await repository.resolve(incident.id, 'GADMIN...OPERATOR');

      await expect(repository.acknowledge(incident.id, 'GADMIN...OPERATOR')).rejects.toThrow();
    });

    it('rejects acknowledging an incident that does not exist', async () => {
      await expect(repository.acknowledge(randomUUID(), 'GADMIN...OPERATOR')).rejects.toThrow();
    });
  });

  describe('resolution', () => {
    it('resolves an active incident directly', async () => {
      const { incident } = await repository.recordDetection(detection());
      const resolved = await repository.resolve(incident.id, 'GADMIN...OPERATOR', 'provider back online');

      expect(resolved.status).toBe(OracleIncidentStatus.Resolved);
      expect(resolved.resolvedBy).toBe('GADMIN...OPERATOR');
      expect(resolved.resolutionNote).toBe('provider back online');
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it('resolves an already-acknowledged incident', async () => {
      const { incident } = await repository.recordDetection(detection());
      await repository.acknowledge(incident.id, 'GADMIN...OPERATOR');
      const resolved = await repository.resolve(incident.id, 'GADMIN...OPERATOR');

      expect(resolved.status).toBe(OracleIncidentStatus.Resolved);
    });

    it('rejects resolving an incident that is already resolved', async () => {
      const { incident } = await repository.recordDetection(detection());
      await repository.resolve(incident.id, 'GADMIN...OPERATOR');

      await expect(repository.resolve(incident.id, 'GADMIN...OPERATOR')).rejects.toThrow();
    });
  });

  describe('recurrence', () => {
    it('opens a new incident when the same subject goes stale again after resolution', async () => {
      const subjectId = randomUUID();
      const first = await repository.recordDetection(detection({ subjectId, detectedAt: '2026-03-01T00:00:00.000Z' }));
      await repository.resolve(first.incident.id, 'GADMIN...OPERATOR');

      const recurrence = await repository.recordDetection(detection({ subjectId, detectedAt: '2026-04-01T00:00:00.000Z' }));

      expect(recurrence.isNew).toBe(true);
      expect(recurrence.incident.id).not.toBe(first.incident.id);
      expect(recurrence.incident.status).toBe(OracleIncidentStatus.Active);
      expect(recurrence.incident.occurrenceCount).toBe(1);

      // The resolved incident's history is preserved, not overwritten.
      const resolvedHistory = await repository.findById(first.incident.id);
      expect(resolvedHistory?.status).toBe(OracleIncidentStatus.Resolved);
    });
  });

  describe('listing', () => {
    it('filters by status and paginates results', async () => {
      const resolvedOne = await repository.recordDetection(detection());
      await repository.resolve(resolvedOne.incident.id, 'GADMIN...OPERATOR');
      await repository.recordDetection(detection());

      const activeOnly = await repository.findMany(1, 50, OracleIncidentStatus.Active);
      expect(activeOnly.data.every((incident) => incident.status === OracleIncidentStatus.Active)).toBe(true);

      const resolvedOnly = await repository.findMany(1, 50, OracleIncidentStatus.Resolved);
      expect(resolvedOnly.data.some((incident) => incident.id === resolvedOne.incident.id)).toBe(true);

      const page1 = await repository.findMany(1, 1);
      expect(page1.data).toHaveLength(1);
      expect(page1.meta.limit).toBe(1);
      // With limit=1, totalPages == total exactly (ceil(total / 1) == total).
      expect(page1.meta.totalPages).toBe(page1.meta.total);
    });
  });
});
