function base64Bytes(data) {
    if (typeof data !== 'string' || !data) return 0;
    const comma = data.indexOf(',');
    const raw = comma >= 0 && /^data:/i.test(data) ? data.slice(comma + 1) : data;
    const clean = raw.replace(/\s/g, '');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function formatBytes(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function looksLikeBase64(value) {
    if (typeof value !== 'string' || value.length < 512 || value.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value);
}

function summarizeBlock(block) {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'image' && typeof block.data === 'string') {
        const bytes = base64Bytes(block.data);
        return { ...block, data: `<base64 omitted · ${formatBytes(bytes)}>` };
    }
    if (block.type === 'audio' && typeof block.data === 'string') {
        const bytes = base64Bytes(block.data);
        return { ...block, data: `<base64 omitted · ${formatBytes(bytes)}>` };
    }
    if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
        if (typeof block.resource.blob === 'string') {
            const bytes = base64Bytes(block.resource.blob);
            return { ...block, resource: { ...block.resource, blob: `<base64 omitted · ${formatBytes(bytes)}>` } };
        }
    }
    return sanitizeUnknown(block);
}

function sanitizeUnknown(value, key = '') {
    if (Array.isArray(value)) return value.map(v => sanitizeUnknown(v));
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && looksLikeBase64(value)) {
            return `<base64/binary omitted · ${formatBytes(base64Bytes(value))}>`;
        }
        return value;
    }
    if (value.type && ['image','audio','resource','resource_link','text'].includes(value.type)) {
        if (value.type === 'text' || value.type === 'resource_link') return value;
        return summarizeBlock(value);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if ((k === 'data' || k === 'blob' || k === 'base64') && typeof v === 'string' && looksLikeBase64(v)) {
            out[k] = `<base64/binary omitted · ${formatBytes(base64Bytes(v))}>`;
        } else {
            out[k] = sanitizeUnknown(v, k);
        }
    }
    return out;
}

export function summarizeToolResult(result) {
    try {
        const safe = result && typeof result === 'object'
            ? { ...result, content: Array.isArray(result.content) ? result.content.map(summarizeBlock) : result.content }
            : result;
        return JSON.stringify(safe);
    } catch {
        return '[tool result summary unavailable]';
    }
}

