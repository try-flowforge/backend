import { query } from '../config/database';

export async function up(): Promise<void> {
    await query(`
        CREATE TABLE IF NOT EXISTS telegram_verification_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code VARCHAR(20) NOT NULL UNIQUE,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            chat_id VARCHAR(255),
            chat_title VARCHAR(255),
            chat_type VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            verified_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT valid_status CHECK (status IN ('pending', 'verified', 'expired'))
        );
    `);

    // Index for quick code lookup
    await query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_verification_codes_code 
        ON telegram_verification_codes(code);
    `);

    // Index for user lookups
    await query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_verification_codes_user_id 
        ON telegram_verification_codes(user_id);
    `);

    // Index for cleanup of expired codes
    await query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_verification_codes_expires_at 
        ON telegram_verification_codes(expires_at);
    `);

}

export async function down(): Promise<void> {
    await query('DROP TABLE IF EXISTS telegram_verification_codes CASCADE');
}
