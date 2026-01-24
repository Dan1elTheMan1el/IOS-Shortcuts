export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // CORS Headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // --- REGISTER ENDPOINT ---
        if (url.pathname === "/register" && request.method === "POST") {
            try {
                const sub = await request.json();

                // 1. Generate Credentials
                const uuid = crypto.randomUUID();
                // Generate a 32-character hex secret
                const secretArray = new Uint8Array(16);
                crypto.getRandomValues(secretArray);
                const secret = [...secretArray].map(b => b.toString(16).padStart(2, '0')).join('');

                // 2. Store in KV (SHORTGAMES_USERS)
                // Store Subscription (for outbound notifications)
                await env.SHORTGAMES_USERS.put(`user:${uuid}:sub`, JSON.stringify(sub));

                // Store Secret (for inbound authorization)
                // Note: In production, you might hash this before storing, but for now we store raw 
                // to match your 'encrypted secret' requirement or simply for verification.
                await env.SHORTGAMES_USERS.put(`user:${uuid}:secret`, secret);

                // 3. Return to Client
                return new Response(JSON.stringify({ uuid, secret }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });

            } catch (err) {
                return new Response(`Error: ${err.message}`, { status: 500, headers: corsHeaders });
            }
        }

        return new Response("ShortGames Worker Ready", { headers: corsHeaders });
    }
};