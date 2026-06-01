/**
 * Minimal tar parser for browser environments.
 *
 * Parses a tar archive (no gzip) into a map of filename → Uint8Array.
 * Handles regular files, directories, and long filenames (ustar format).
 * Ignores everything except regular files.
 */

const BLOCK_SIZE = 512;

interface TarHeader {
  name: string;
  size: number;
  type: number;
}

const TarEntryType = {
  Regular: 0 as const,
  Normal: 48 as const,       // '0'
  LongName: 76 as const,     // 'L' (GNU tar)
  Directory: 53 as const,    // '5'
} as const;

type TarEntryType = (typeof TarEntryType)[keyof typeof TarEntryType];

function readString(view: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  // Trim trailing NUL and spaces
  while (end > offset && (view[end - 1] === 0 || view[end - 1] === 0x20)) {
    end--;
  }
  return new TextDecoder("utf-8").decode(view.subarray(offset, end));
}

function readOctal(view: Uint8Array, offset: number, length: number): number {
  const str = readString(view, offset, length);
  return parseInt(str, 8) || 0;
}

function parseHeader(block: Uint8Array): TarHeader | undefined {
  // If the entire block is zero, this is the end-of-archive marker
  let allZero = true;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (block[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    return undefined;
  }

  const prefix = readString(block, 345, 155);
  const name = readString(block, 0, 100);
  const size = readOctal(block, 124, 12);
  const typeFlag = block[156] ?? TarEntryType.Regular;

  const fullPath = prefix.length > 0 ? `${prefix}/${name}` : name;

  return {
    name: fullPath,
    size,
    type: typeFlag as TarEntryType,
  };
}

/**
 * Extract files from a raw tar archive buffer.
 *
 * @returns Map from file path to file contents.
 */
export function extractTar(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new Uint8Array(buffer);
  let offset = 0;
  let longName: string | undefined;

  while (offset + BLOCK_SIZE <= view.length) {
    const headerBlock = view.subarray(offset, offset + BLOCK_SIZE);
    const header = parseHeader(headerBlock);
    if (header === undefined) {
      // End of archive
      break;
    }

    offset += BLOCK_SIZE;

    // Handle GNU long name entries
    if (header.type === TarEntryType.LongName) {
      const dataBlocks = Math.ceil(header.size / BLOCK_SIZE);
      const nameBytes = view.subarray(offset, offset + header.size);
      let nameEnd = header.size;
      while (nameEnd > 0 && nameBytes[nameEnd - 1] === 0) {
        nameEnd--;
      }
      longName = new TextDecoder("utf-8").decode(nameBytes.subarray(0, nameEnd));
      offset += dataBlocks * BLOCK_SIZE;
      continue;
    }

    // Skip non-regular files (directories, etc.)
    if (header.type !== TarEntryType.Regular &&
        header.type !== TarEntryType.Normal &&
        header.type !== 0) {
      const dataBlocks = Math.ceil(header.size / BLOCK_SIZE);
      offset += dataBlocks * BLOCK_SIZE;
      longName = undefined;
      continue;
    }

    if (header.size === 0) {
      longName = undefined;
      continue;
    }

    const dataBlocks = Math.ceil(header.size / BLOCK_SIZE);
    const data = view.subarray(offset, offset + header.size);
    const fileName = longName ?? header.name;

    // Strip leading ./ from paths
    const cleanName = fileName.replace(/^\.\//, "");

    files.set(cleanName, new Uint8Array(data));
    offset += dataBlocks * BLOCK_SIZE;
    longName = undefined;
  }

  return files;
}

/**
 * Decompress a gzip buffer and extract the tar archive within.
 *
 * Uses the browser's DecompressionStream API (available in all modern
 * browsers and recent worker runtimes).
 */
export async function extractTarGzip(
  gzipBuffer: ArrayBuffer,
): Promise<Map<string, Uint8Array>> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(new Uint8Array(gzipBuffer));
  writer.close();

  // Collect all decompressed chunks
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    totalLength += result.value.length;
  }

  // Merge into a single buffer
  const tarBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    tarBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return extractTar(tarBuffer.buffer);
}
