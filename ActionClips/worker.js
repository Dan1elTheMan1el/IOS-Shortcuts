export default {
    async fetch(request, env, ctx) {
        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            });
        }

        // Administrative endpoints for managing IPv6 blacklist
        const url = new URL(request.url);
        if (url.pathname === "/blacklist") {
            const adminKey = request.headers.get("x-admin-key");
            if (adminKey !== env.ADMIN_KEY) {
                return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            }

            if (request.method === "GET") {
                const raw = await env.ACTIONCLIPS_BLACKLIST.get("entries");
                const entries = raw ? JSON.parse(raw) : [];
                return new Response(JSON.stringify(entries), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            }

            const adminBody = await request.json().catch(() => ({}));
            const entry = adminBody.entry && String(adminBody.entry).trim();
            if (!entry) {
                return new Response(JSON.stringify({ error: "missing entry" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            }

            const raw = await env.ACTIONCLIPS_BLACKLIST.get("entries");
            const entries = raw ? JSON.parse(raw) : [];

            if (request.method === "POST") {
                if (!entries.includes(entry)) {
                    entries.push(entry);
                    await env.ACTIONCLIPS_BLACKLIST.put("entries", JSON.stringify(entries));
                }
                return new Response(JSON.stringify({ ok: true, entries }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            } else if (request.method === "DELETE") {
                const idx = entries.indexOf(entry);
                if (idx >= 0) {
                    entries.splice(idx, 1);
                    await env.ACTIONCLIPS_BLACKLIST.put("entries", JSON.stringify(entries));
                }
                return new Response(JSON.stringify({ ok: true, entries }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            }

            return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }

        // Early IPv6 blacklist check (household-level /64 by default)
        const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || null;

        const isValidIPv6 = ip => !!ip && ip.includes(":");

        const parseIPv6ToBigInt = (ip) => {
            // drop zone id like %eth0
            ip = ip.split("%")[0];
            const parts = ip.split("::");
            let left = [], right = [];
            if (parts.length === 1) {
                left = parts[0].split(":");
                right = [];
            } else {
                left = parts[0] ? parts[0].split(":") : [];
                right = parts[1] ? parts[1].split(":") : [];
            }
            const leftCount = left.filter(Boolean).length;
            const rightCount = right.filter(Boolean).length;
            const missing = 8 - (leftCount + rightCount);
            const hextets = [...left.filter(Boolean), ...Array(missing).fill("0"), ...right.filter(Boolean)];
            let val = 0n;
            for (const h of hextets) {
                const n = h === "" ? 0 : parseInt(h, 16) || 0;
                val = (val << 16n) + BigInt(n);
            }
            return val;
        };

        const ipv6InCidr = (ip, cidr) => {
            try {
                const [net, maskStr] = cidr.split("/");
                const mask = maskStr ? Number(maskStr) : 64;
                if (mask < 0 || mask > 128) return false;
                const ipBig = parseIPv6ToBigInt(ip);
                const netBig = parseIPv6ToBigInt(net);
                const maskBig = mask === 0 ? 0n : (((1n << BigInt(mask)) - 1n) << BigInt(128 - mask));
                return (ipBig & maskBig) === (netBig & maskBig);
            } catch (e) {
                return false;
            }
        };

        const isBlocked = async (ip) => {
            if (!ip || !isValidIPv6(ip)) return false;
            const raw = await env.ACTIONCLIPS_BLACKLIST.get("entries");
            const entries = raw ? JSON.parse(raw) : [];
            for (const e of entries) {
                const entry = String(e || "").trim();
                if (!entry) continue;
                if (entry.includes("/")) {
                    if (ipv6InCidr(ip, entry)) return true;
                } else {
                    // default to /64 for household blocking
                    const cidr = entry + "/64";
                    if (ipv6InCidr(ip, cidr)) return true;
                }
            }
            return false;
        };

        if (await isBlocked(clientIp)) {
            return new Response(JSON.stringify({ ok: false, reason: "blacklisted" }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }

        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Use POST" }), {
                status: 405,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        let body = {};
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        try {
            const { name, clip64 } = body;
            const { description = "", profile = {} } = body;
            if (!name || !clip64 || !profile || !profile.username) {
                return new Response(JSON.stringify({ error: "Missing required fields: name, clip64, profile.username" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            // Resolve webhook url from env binding ACTIONCLIPS_WEBHOOK
            const webhook = env.ACTIONCLIPS_WEBHOOK;
            if (!webhook) {
                return new Response(JSON.stringify({ error: "Server misconfiguration: ACTIONCLIPS_WEBHOOK env binding is missing" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            // Schedule background processing and return immediately
            ctx.waitUntil((async () => {
                try {
                    const base64ToUint8Array = (b64) => {
                        const bin = atob(b64);
                        const len = bin.length;
                        const arr = new Uint8Array(len);
                        for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
                        return arr;
                    };

                    // Recreate unsigned shortcut blob
                    const clipArr = base64ToUint8Array(clip64);
                    const unsignedShortcutBlob = new Blob([clipArr]);

                    // Recreate profile icon
                    let profileBlob = null;
                    if (profile.icon64) {
                        const pArr = base64ToUint8Array(profile.icon64);
                        profileBlob = new Blob([pArr], { type: "image/png" });
                    }

                    // Screenshot handling
                    let screenshotBlob = null;
                    try {
                        const s = body.screenshot;
                        if (s) {
                            const sArr = base64ToUint8Array(s);
                            screenshotBlob = new Blob([sArr], { type: "image/png" });
                        }
                    } catch (err) {
                        screenshotBlob = null;
                    }

                    // Sign unsigned.shortcut via Hubsign
                    const signForm = new FormData();
                    signForm.append("shortcut", unsignedShortcutBlob, "unsigned.shortcut");
                    signForm.append("shortcutName", "ActionClip " + name);

                    const signResp = await fetch("https://hubsign.routinehub.services/sign", {
                        method: "POST",
                        body: signForm,
                    });

                    if (!signResp.ok) {
                        const errorText = await signResp.text();

                        // Send error + unsigned.shortcut to webhook and stop
                        const errEmbed = {
                            title: "Signing error for: " + name,
                            fields: [
                                { name: "Error", value: errorText || signResp.statusText, inline: false },
                                { name: "Submitter", value: profile.username || "Unknown", inline: true },
                            ],
                            timestamp: new Date().toISOString(),
                        };

                        const errForm = new FormData();
                        errForm.append("payload_json", JSON.stringify({ embeds: [errEmbed] }));
                        errForm.append("files[0]", unsignedShortcutBlob, "unsigned.shortcut");
                        if (profileBlob) errForm.append("files[1]", profileBlob, "profile.png");
                        if (screenshotBlob) errForm.append("files[2]", screenshotBlob, "screenshot.png");

                        try {
                            await fetch(webhook, { method: "POST", body: errForm });
                        } catch (e) {
                            console.error("Failed to post signing error to webhook:", e);
                        }
                        return;
                    }

                    const signedShortcutBlob = await signResp.blob();

                    // Build Discord embed
                    const embed = {
                        title: "Submission: " + name,
                        fields: [
                            { name: "Description", value: description || "(No description provided)", inline: false },
                            { name: "IP", value: "||`" + (request.headers.get('CF-Connecting-IP') || request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || request.headers.get('X-Forwarded-For') || 'Unknown') + "`||", inline: false },
                        ],
                        timestamp: new Date().toISOString(),
                    };

                    if (profile.username) {
                        embed.author = { name: profile.username };
                        if (profileBlob) embed.author.icon_url = "attachment://profile.png";
                    }

                    if (screenshotBlob) {
                        embed.image = { url: "attachment://combined.png" };
                    }

                    const payload = { embeds: [embed] };

                    // Prepare multipart body
                    const form = new FormData();
                    form.append("payload_json", JSON.stringify(payload));

                    // First attachment: signed clip
                    form.append("files[0]", signedShortcutBlob, "ActionClip" + name + ".shortcut");

                    // Additional attachments
                    if (screenshotBlob) form.append("files[1]", screenshotBlob, "screenshot.png");
                    if (profileBlob) form.append("files[2]", profileBlob, "profile.png");

                    try {
                        await fetch(webhook, { method: "POST", body: form });
                    } catch (e) {
                        console.error("Failed to post submission to webhook:", e);
                    }
                } catch (err) {
                    console.error("Background submission handler error:", err);
                    // As a last resort, attempt to notify via webhook with whatever we have
                    try {
                        const errEmbed = {
                            title: "Processing error",
                            description: err.message || String(err),
                            timestamp: new Date().toISOString(),
                        };
                        const errForm = new FormData();
                        errForm.append("payload_json", JSON.stringify({ embeds: [errEmbed] }));
                        await fetch(webhook, { method: "POST", body: errForm });
                    } catch (e) {
                        console.error("Failed to report processing error to webhook:", e);
                    }
                }
            })());

            return new Response(JSON.stringify({ ok: true, status: "received" }), {
                status: 202,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }
    },
};
