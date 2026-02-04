import crypto from 'crypto';

/**
 * HMAC-based request signing for secure inter-service communication.
 */

export interface SignedRequest {
    timestamp: string;
    signature: string;
}

/**
 * Create HMAC signature for a request.
 * Signature = HMAC-SHA256(timestamp + method + path + body)
 */
export function signRequest(
    secret: string,
    method: string,
    path: string,
    body: string,
    timestamp?: string
): SignedRequest {
    const ts = timestamp || Date.now().toString();
    const payload = `${ts}:${method.toUpperCase()}:${path}:${body}`;

    const signature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    return {
        timestamp: ts,
        signature,
    };
}

// Header names for signed requests
export const HMAC_HEADERS = {
    TIMESTAMP: 'x-timestamp',
    SIGNATURE: 'x-signature',
} as const;
