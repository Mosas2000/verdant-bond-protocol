
/**
 * Upload policy for IPFS document/evidence uploads.
 *
 * Enforces defensive controls before untrusted content is pinned:
 *  - maximum content size
 *  - allowed MIME types (allow-list) with extension match
 *  - content sniffing against magic bytes to catch extension/mime mismatch
 *  - an optional pluggable malware-scan hook
 *
 * Values can be tuned via environment variables:
 *  `IPFS_MAX_FILE_BYTES`          — max accepted payload size in bytes.
 *  `IPFS_SCAN_ENABLED`            — 'true' to enable the scan hook.
 *  `IPFS_BLOCKED_EXTENSIONS`      — extra extensions to reject (comma separated).
 */

export interface ScanResult {
  /** True when the payload is considered safe to pin. */
  safe: boolean;
  /** Human-readable reason when rejected. */
  reason?: string;
}

export interface FileScanHook {
  /** Optionally return a structured buffer/mimetype for the scanner. */
  scan(input: { buffer: Buffer; mimetype: string; filename: string }): Promise<ScanResult>;
}

export class UploadRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export interface UploadPolicyOptions {
  maxFileBytes?: number;
  scanEnabled?: boolean;
  scanHook?: FileScanHook;
  blockedExtensions?: string[];
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Allow-list of accepted document/evidence MIME types. */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/json': ['.json'],
  'application/octet-stream': ['.ser', '.bin'],
  'text/plain': ['.txt', '.md'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/svg+xml': ['.svg'],
};

/** Magic-byte sniffers (first bytes of a buffer) to detect known types. */
const MAGIC_SNIFFERS: Array<{ mime: string; match: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', match: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', match: (b) => b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  { mime: 'image/jpeg', match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/svg+xml', match: (b) => b.length >= 5 && /^\s*</.test(b.subarray(0, 64).toString('latin1')) && b.subarray(0, 64).toString('latin1').includes('<svg') },
  { mime: 'application/json', match: (b) => {
      const head = b.subarray(0, 64).toString('latin1').trimStart();
      return head.startsWith('{') || head.startsWith('[');
    } },
];

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

function sniffMime(buffer: Buffer): string | null {
  for (const s of MAGIC_SNIFFERS) {
    if (s.match(buffer)) return s.mime;
  }
  return null;
}

export class IpfsUploadPolicy {
  private readonly maxFileBytes: number;
  private readonly scanEnabled: boolean;
  private readonly scanHook?: FileScanHook;
  private readonly blockedExtensions: Set<string>;

  constructor(options: UploadPolicyOptions = {}) {
    this.maxFileBytes = options.maxFileBytes ?? this.fromEnvInt('IPFS_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
    this.scanEnabled = options.scanEnabled ?? process.env.IPFS_SCAN_ENABLED === 'true';
    this.scanHook = options.scanHook;
    this.blockedExtensions = new Set([
      ...(options.blockedExtensions ?? []),
      ...(process.env.IPFS_BLOCKED_EXTENSIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      '.exe', '.dll', '.sh', '.bat', '.cmd', '.msi', '.js', '.jar', '.apk',
    ]);
  }

  private fromEnvInt(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * Validate a file against the upload policy. Returns the resolved allowed
   * MIME type (falling back to the sniffed type) on success or throws an
   * `UploadRejectedError` describing the reason.
   */
  async validate(input: { buffer: Buffer; mimetype: string; filename: string }): Promise<string> {
    const { buffer, mimetype, filename } = input;

    if (buffer.length === 0) {
      throw new UploadRejectedError('EMPTY_FILE', 'Cannot upload an empty file.');
    }
    if (buffer.length > this.maxFileBytes) {
      throw new UploadRejectedError(
        'FILE_TOO_LARGE',
        `File exceeds the ${this.maxFileBytes}-byte upload limit.`,
      );
    }

    const ext = extensionOf(filename);
    if (this.blockedExtensions.has(ext)) {
      throw new UploadRejectedError('BLOCKED_EXTENSION', `File extension "${ext}" is not allowed.`);
    }

    // Allow a declared JSON/text/octet-stream type that we cannot sniff, but
    // require a known allow-listed mimetype overall.
    const normalizedMime = mimetype?.toLowerCase() || '';
    const allowed = this.allowedMimeFor(normalizedMime);
    if (!allowed) {
      throw new UploadRejectedError('UNSUPPORTED_MIME', `MIME type "${mimetype}" is not allowed.`);
    }

    if (!ALLOWED_MIME_TYPES[allowed]!.includes(ext) && !(allowed === 'application/octet-stream')) {
      throw new UploadRejectedError(
        'EXTENSION_MISMATCH',
        `Extension "${ext}" does not match MIME type "${allowed}".`,
      );
    }

    // Content sniffing: reject when the bytes clearly indicate a different type.
    const sniffed = sniffMime(buffer);
    if (sniffed && sniffed !== allowed && !(allowed === 'application/octet-stream')) {
      throw new UploadRejectedError(
        'CONTENT_MISMATCH',
        `Declared MIME type "${allowed}" does not match detected content type "${sniffed}".`,
      );
    }

    if (this.scanEnabled) {
      if (!this.scanHook) {
        throw new UploadRejectedError(
          'SCAN_UNAVAILABLE',
          'Malware scanning is enabled but no scan hook is configured.',
        );
      }
      const scan = await this.scanHook.scan({ buffer, mimetype: allowed, filename });
      if (!scan.safe) {
        throw new UploadRejectedError('SCAN_REJECTED', scan.reason || 'File was rejected by the malware scanner.');
      }
    }

    return allowed;
  }

  private allowedMimeFor(mime: string): string | null {
    if (ALLOWED_MIME_TYPES[mime]) return mime;
    if (mime === 'application/octet-stream' || mime === '') {
      return Object.keys(ALLOWED_MIME_TYPES).includes('application/octet-stream') ? 'application/octet-stream' : null;
    }
    return null;
  }
}
