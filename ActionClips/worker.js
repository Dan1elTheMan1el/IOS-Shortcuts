export default {
    async fetch(request, env) {
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

        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Use POST" }), {
                status: 405,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        // Read process from header (preferred) or from body.process
        const headerProcess = request.headers.get("process");
        let body = {};
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        const process = (headerProcess || body.process || "").toString();

        if (process !== "submitClip") {
            return new Response(JSON.stringify({ error: `Unsupported process: ${process}` }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        try {
            const { name, clip64, screenshots = [], description = "", profile = {} } = body;
            if (!name || !clip64 || !profile || !profile.username) {
                return new Response(JSON.stringify({ error: "Missing required fields: name, clip64, profile.username" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            // Resolve webhook url from env binding ACTIONCLIPS_WEBHOOK only
            const webhook = env.ACTIONCLIPS_WEBHOOK;
            if (!webhook) {
                return new Response(JSON.stringify({ error: "Server misconfiguration: ACTIONCLIPS_WEBHOOK env binding is missing" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            // Helpers
            const stripDataUrlPrefix = (s) => {
                if (!s) return s;
                const idx = s.indexOf("base64,");
                return idx !== -1 ? s.slice(idx + 7) : s;
            };

            const base64ToUint8Array = (b64) => {
                const bin = atob(b64);
                const len = bin.length;
                const arr = new Uint8Array(len);
                for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
                return arr;
            };

            const inferMimeFromBase64 = (s) => {
                if (!s) return "application/octet-stream";
                if (s.startsWith("/9j/")) return "image/jpeg"; // jpeg magic
                if (s.startsWith("iVBOR")) return "image/png"; // png magic
                return "application/octet-stream";
            };

            // Decode clip zip
            const clipB64 = stripDataUrlPrefix(clip64);
            const clipArr = base64ToUint8Array(clipB64);
            const clipBlob = new Blob([clipArr], { type: "application/zip" });

            // Decode profile icon if present
            let profileBlob = null;
            if (profile.icon64) {
                const pB64 = stripDataUrlPrefix(profile.icon64);
                const pMime = inferMimeFromBase64(pB64);
                const pArr = base64ToUint8Array(pB64);
                profileBlob = new Blob([pArr], { type: pMime });
            }

            // Single screenshot handling: expect `body.screenshot` (base64 data URL or raw base64)
            let combinedBlob = null;
            let debugInfo = {};
            try {
                const s = body.screenshot;
                if (s) {
                    const sB64 = stripDataUrlPrefix(s);
                    const sMime = inferMimeFromBase64(sB64);
                    const sArr = base64ToUint8Array(sB64);
                    combinedBlob = new Blob([sArr], { type: sMime });

                    // sanity check: if the blob looks suspiciously small, treat as invalid
                    if (combinedBlob.size < 200) {
                        debugInfo = { method: "single", screenshotSize: combinedBlob.size, invalid: true };
                        combinedBlob = null;
                    } else {
                        debugInfo = { method: "single", screenshotSize: combinedBlob.size };
                    }
                } else {
                    debugInfo = { method: "none" };
                }
            } catch (err) {
                combinedBlob = null;
                debugInfo = { method: "error", message: err.message };
            }

            // If caller asked for debug, return diagnostics instead of posting to the webhook
            if (body.debug) {
                return new Response(JSON.stringify({ debug: true, clipSize: clipBlob.size, profileSize: profileBlob?.size || 0, screenshotsCount: (screenshots || []).length, debugInfo }), {
                    status: 200,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            // Build Discord embed
            const embed = {
                title: "Action Clip Submitted",
                fields: [
                    { name: "Clip Name", value: name, inline: false },
                    { name: "Description", value: description || "(No description provided)", inline: false },
                ],
                timestamp: new Date().toISOString(),
            };

            // author: use attachment reference if profile icon provided
            if (profile.username) {
                embed.author = { name: profile.username };
                if (profileBlob) embed.author.icon_url = "attachment://profile.png";
            }

            if (combinedBlob) {
                embed.image = { url: "attachment://combined.png" };
            }

            const payload = { embeds: [embed] };

            // Prepare multipart body
            const form = new FormData();
            form.append("payload_json", JSON.stringify(payload));
            // Attach files. Discord supports multiple attachments in a single multipart request
            // First attachment: clip shortcut
            form.append("files[0]", clipBlob, "ActionClip" + name + ".shortcut");

            // Second: combined screenshot
            if (combinedBlob) {
                form.append("files[1]", combinedBlob, "combined.png");
            }

            // Third: profile icon
            if (profileBlob) {
                form.append("files[2]", profileBlob, "profile.png");
            }

            const resp = await fetch(webhook, { method: "POST", body: form });

            const respText = await resp.text();
            if (!resp.ok) {
                return new Response(JSON.stringify({ ok: false, status: resp.status, text: respText }), {
                    status: 502,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }

            return new Response(JSON.stringify({ ok: true, status: resp.status, text: respText }), {
                status: 200,
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
