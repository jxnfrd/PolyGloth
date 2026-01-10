export const dynamic = 'force-dynamic';

export default function ProbePage() {
    return (
        <div style={{ padding: '50px', fontFamily: 'sans-serif' }}>
            <h1>✅ Probe Page Works!</h1>
            <p>If you see this, the Deployment Pipeline is working for PAGES.</p>
            <p>Timestamp: {new Date().toISOString()}</p>
        </div>
    );
}
