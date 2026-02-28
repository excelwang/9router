/**
 * Native UUID implementation for Cloudflare Workers
 * Avoids external dependencies that fail in monorepo wrangler bundles
 */

export function v4() {
    return crypto.randomUUID();
}

/**
 * UUID v5 (name-based SHA-1)
 * Note: This is ASYNC in Workers but was sync in the uuid package.
 */
export async function v5(name, namespace) {
    const nsBytes = parseUuid(namespace);
    const nameBytes = new TextEncoder().encode(name);
    const data = new Uint8Array(nsBytes.length + nameBytes.length);
    data.set(nsBytes);
    data.set(nameBytes, nsBytes.length);

    const hash = await crypto.subtle.digest("SHA-1", data);
    const bytes = new Uint8Array(hash).slice(0, 16);

    bytes[6] = (bytes[6] & 0x0f) | 0x50; // set version to 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // set variant to 10

    return stringifyUuid(bytes);
}

function parseUuid(uuid) {
    const v = uuid.replace(/-/g, "");
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function stringifyUuid(bytes) {
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export default { v4, v5, DNS };
