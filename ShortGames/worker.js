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
                return new Response(JSON.stringify({ uuid, secret, msg: "Success" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });

            } catch (err) {
                return new Response(`Error: ${err.message}`, { status: 500, headers: corsHeaders });
            }
        } else if (url.pathname === "/user") {
            if (request.method === "GET") {
                // --- USER INFO ENDPOINT ---
                const uuid = request.headers.get("uuid");
                const secret = request.headers.get("secret");

                if (!uuid || !secret) {
                    return new Response(JSON.stringify({ msg: "Missing UUID or Secret" }), { status: 400, headers: corsHeaders });
                }

                // Retrieve stored secret to verify
                const storedSecret = await env.SHORTGAMES_USERS.get(`user:${uuid}:secret`);
                if (storedSecret !== secret) {
                    return new Response(JSON.stringify({ msg: "Unauthorized" }), { status: 401, headers: corsHeaders });
                }

                // Fetch each requested field
                const params = JSON.parse(request.headers.get("params") || "[]");
                const result = { msg: "Success" };
                for (const field of params) {
                    const value = await env.SHORTGAMES_USERS.get(`user:${uuid}:${field}`);
                    if (value !== null) {
                        result[field] = value;
                    } else {
                        return new Response(JSON.stringify({ msg: "Param not found: " + field }), { status: 404, headers: corsHeaders });
                    }
                }
                return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            } else if (request.method === "POST") {
                // --- USER UPDATE ENDPOINT ---
                const uuid = request.headers.get("uuid");
                const secret = request.headers.get("secret");

                if (!uuid || !secret) {
                    return new Response(JSON.stringify({ msg: "Missing UUID or Secret" }), { status: 400, headers: corsHeaders });
                }

                // Retrieve stored secret to verify
                const storedSecret = await env.SHORTGAMES_USERS.get(`user:${uuid}:secret`);
                if (storedSecret !== secret) {
                    return new Response(JSON.stringify({ msg: "Unauthorized" }), { status: 401, headers: corsHeaders });
                }

                try {
                    const updates = await request.json();
                    const result = { msg: "Success" };
                    for (const [key, value] of Object.entries(updates)) {
                        // Only allow certain keys to be updated
                        if (key === "username") { // ADD MORE ALLOWED KEYS AS NEEDED
                            await env.SHORTGAMES_USERS.put(`user:${uuid}:${key}`, value.slice(0, 15));
                            result[key] = value.slice(0, 15);
                        }
                    }
                    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                } catch (err) {
                    return new Response(`Error: ${err.message}`, { status: 500, headers: corsHeaders });
                }
            }

            return new Response("ShortGames Worker Ready", { headers: corsHeaders });
        }
    }
}