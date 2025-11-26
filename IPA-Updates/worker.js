export default {
    async fetch(request) {
        // Handle CORS Preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                }
            });
        }

        const url = new URL(request.url);
        const method = request.method;
        const process = url.searchParams.get("process");

        // Handle GET Repo
        if (method === "GET" && process === "getRepo") {
            const repoURL = url.searchParams.get("repoURL");
            if (!repoURL) return new Response("Missing repoURL", { status: 400 });

            try {
                const resp = await fetch(repoURL);
                const data = await resp.text();
                return new Response(data, {
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": "application/json",
                    }
                });
            } catch (e) {
                return new Response(`Error fetching repo: ${e}`, { status: 500 });
            }
        }

        // Parse POST body
        let body = {};
        if (method === "POST") {
            try {
                body = await request.json();
            } catch {
                return new Response("Invalid JSON body", { status: 400 });
            }
        }

        // Handle AppsInfo
        if (method === "POST" && body.process === "AppsInfo") {
            const results = body.data.map(async (item) => {
                const { repoURL, ignore, bundleIdentifier, version } = item;
                try {
                    const repoResp = await fetch(repoURL);
                    const repo = await repoResp.json();
                    const repoName = repo.name || "Unknown Repo";
                    const app = repo.apps?.find(a => a.bundleIdentifier === bundleIdentifier);

                    if (!app) return `ERROR: App ${bundleIdentifier} not found`;

                    const appName = app.name || bundleIdentifier;
                    const latest = app.version || app.versions?.[0]?.version || "Unknown";
                    const updateAvailable = ignore !== "Yes" && version !== latest;

                    let subtitle = `${repoName} | ${version}`;
                    if (ignore === "Yes") subtitle += " ⚠️ Ignoring Updates!";
                    else if (updateAvailable) subtitle += " (⬆️ Update Available!)";

                    let iconBase64 = "";
                    if (app.iconURL) {
                        const iconResp = await fetch(app.iconURL);
                        const buf = await iconResp.arrayBuffer();
                        iconBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                    }

                    const removed = body.data.filter(e => e !== item);
                    const emailDict = {
                        name: appName,
                        ignore,
                        installed: version,
                        latest,
                        downloadURL: app.downloadURL || "",
                        repoURL,
                        bundleIdentifier,
                        removedDict: removed
                    };

                    const encodedEmail = encodeURIComponent(JSON.stringify(emailDict));
                    return `BEGIN:VCARD\nVERSION:3.0\nN:${appName}\nORG:${subtitle}\nPHOTO;BASE64:${iconBase64}\nitem1.EMAIL:${encodedEmail}\nEND:VCARD`;
                } catch {
                    return `ERROR: Failed to load repo: ${repoURL}`;
                }
            });

            const resolvedResults = await Promise.all(results);
            return new Response(resolvedResults.join("\n\n"), {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "text/plain"
                }
            });
        }

        // Handle updateNotif
        if (method === "POST" && body.process === "updateNotif") {
            const appList = body.data || [];
            const settings = body.settings || {};

            const updates = await Promise.all(appList.map(async (app) => {
                if (app.ignore === "Yes") return null;

                try {
                    const resp = await fetch(app.repoURL);
                    const repo = await resp.json();
                    const match = repo.apps?.find(a => a.bundleIdentifier === app.bundleIdentifier);

                    if (!match) return null;

                    const latest = match.version || match.versions?.[0]?.version;
                    const downloadURL = match.downloadURL || match.versions?.[0]?.downloadURL;

                    if (latest && latest !== app.version) {
                        app.version = latest;

                        if (settings.webhookURL) {
                            const payload = {
                                username: settings.webhookProfile?.username,
                                avatar_url: settings.webhookProfile?.avatarURL,
                                embeds: [
                                    {
                                        title: match.name,
                                        description: repo.name || "Unknown Repo",
                                        color: parseInt((match.tintColor || "000000").replace("#", ""), 16),
                                        thumbnail: { url: match.iconURL },
                                        fields: [
                                            { name: "Version", value: latest, inline: true },
                                            { name: "Download", value: `[Click Here](${downloadURL})`, inline: true }
                                        ]
                                    }
                                ]
                            };

                            await fetch(settings.webhookURL, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload)
                            });
                        }

                        return {
                            name: match.name,
                            subtitle: repo.name || "Unknown Repo",
                            iconURL: match.iconURL,
                            tintColor: match.tintColor || "000000",
                            version: latest,
                            downloadURL
                        };
                    }
                } catch {
                    return null;
                }
            }));

            return new Response(JSON.stringify(appList), {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "application/json"
                }
            });
        }

        // Default 404 Response
        return new Response("Unknown request", { status: 404 });
    }
};
