function estimateTextTokens(text) {
    const value = String(text ?? '');
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const rest = Math.max(0, value.length - cjk);
    return Math.max(0, Math.ceil(cjk * 1.05 + rest / 4));
}

function base64Bytes(data) {
    if (typeof data !== 'string' || !data) return 0;
    const comma = data.indexOf(',');
    const raw = comma >= 0 && /^data:/i.test(data) ? data.slice(comma + 1) : data;
    const clean = raw.replace(/\s/g, '');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function looksLikeBase64(value) {
    if (typeof value !== 'string' || value.length < 512 || value.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value);
}

function emptyMetrics() {
    return {
        textTokens: 0,
        imageCount: 0, imageBytes: 0,
        audioCount: 0, audioBytes: 0,
        blobCount: 0, blobBytes: 0,
        binaryCount: 0, binaryBytes: 0,
        linkCount: 0,
    };
}

function scan(value, metrics, key = '') {
    if (value == null) return;
    if (typeof value === 'string') {
        const binaryKey = /^(data|blob|base64|image|audio|content)$/i.test(key);
        if (binaryKey && looksLikeBase64(value)) {
            metrics.binaryCount += 1;
            metrics.binaryBytes += base64Bytes(value);
        } else {
            metrics.textTokens += estimateTextTokens(value);
        }
        return;
    }
    if (typeof value !== 'object') {
        metrics.textTokens += estimateTextTokens(String(value));
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) scan(item, metrics);
        return;
    }

    if (value.type === 'text') {
        metrics.textTokens += estimateTextTokens(value.text || '');
        return;
    }
    if (value.type === 'image' && typeof value.data === 'string') {
        metrics.imageCount += 1;
        metrics.imageBytes += base64Bytes(value.data);
        return;
    }
    if (value.type === 'audio' && typeof value.data === 'string') {
        metrics.audioCount += 1;
        metrics.audioBytes += base64Bytes(value.data);
        return;
    }
    if (value.type === 'resource_link') {
        metrics.linkCount += 1;
        metrics.textTokens += estimateTextTokens([value.uri, value.name, value.description, value.mimeType].filter(Boolean).join(' '));
        return;
    }
    if (value.type === 'resource' && value.resource && typeof value.resource === 'object') {
        const r = value.resource;
        if (typeof r.text === 'string') {
            metrics.textTokens += estimateTextTokens(r.text);
        } else if (typeof r.blob === 'string') {
            metrics.blobCount += 1;
            metrics.blobBytes += base64Bytes(r.blob);
        }
        return;
    }

    for (const [k, v] of Object.entries(value)) {
        if (k === '_meta') continue;
        scan(v, metrics, k);
    }
}

export function measureArgs(args) {
    const metrics = emptyMetrics();
    scan(args, metrics);
    return metrics;
}

export function measureResult(result) {
    const metrics = emptyMetrics();
    if (Array.isArray(result?.content)) scan(result.content, metrics);
    return metrics;
}

