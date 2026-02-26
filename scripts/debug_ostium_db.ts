
import { query } from '../src/config/database';

async function debugDB() {
    try {
        const result = await query(
            'SELECT id, action, network, status, left(request_payload::text, 100) as truncated_payload, error_code, error_message, created_at FROM perps_executions ORDER BY created_at DESC LIMIT 10'
        );

        console.log('--- Recent Ostium Executions ---');
        console.table(result.rows);

        const stats = await query(
            'SELECT action, status, count(*) FROM perps_executions GROUP BY action, status'
        );
        console.log('\n--- Status Breakdown ---');
        console.table(stats.rows);

        // Look for successful opens to compare types
        const successfulOpens = await query(
            "SELECT action, request_payload FROM perps_executions WHERE action = 'open' AND status = 'success' LIMIT 1"
        );
        if (successfulOpens.rows.length > 0) {
            console.log('\n--- Successful Open Payload Example ---');
            console.log(JSON.stringify(successfulOpens.rows[0].request_payload, null, 2));
        } else {
            console.log('\nNo successful open positions found in history.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Debug script failed:', err);
        process.exit(1);
    }
}

debugDB();
