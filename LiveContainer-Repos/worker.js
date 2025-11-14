export default { // https://repo-html.friedmandaniel111.workers.dev/
    async fetch(request, env, ctx) {
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Use POST" }), {
                status: 405,
                headers: { "Content-Type": "application/json" },
            });
        }

        try {
            const body = await request.json();
            const { process } = body;

            if (!process) {
                return new Response(JSON.stringify({ error: "Missing process field" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (process === "repo") {
                return await handleRepo(body);
            } else if (process === "search") {
                return await handleSearch(body);
            } else if (process === "getLatest") {
                return await handleGetLatest(body, request);
            } else {
                return new Response(JSON.stringify({ error: `Unsupported process: ${process}` }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
};

async function handleRepo(body) {
    const { repoUrl } = body;
    if (!repoUrl) {
        return new Response(JSON.stringify({ error: "Missing repoUrl" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const repoResp = await fetch(repoUrl);
    if (!repoResp.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch repo JSON" }), {
            status: repoResp.status,
            headers: { "Content-Type": "application/json" },
        });
    }

    const repoData = await repoResp.json();
    const repoName = repoData.name ?? "";
    const apps = Array.isArray(repoData.apps) ? repoData.apps : [];

    const finalHtml = buildAppsHtml(apps, { repo: repoName, repoURL: repoUrl });

    return new Response(JSON.stringify({ name: repoName, html: finalHtml }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

async function handleSearch(body) {
    const { repoUrls, keyword } = body;
    if (!Array.isArray(repoUrls) || repoUrls.length === 0) {
        return new Response(JSON.stringify({ error: "Missing repoUrls (array)" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }
    if (!keyword) {
        return new Response(JSON.stringify({ error: "Missing keyword" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    let results = [];
    for (const url of repoUrls) {
        try {
            const repoResp = await fetch(url);
            if (repoResp.ok) {
                const repoData = await repoResp.json();
                const repoName = repoData.name ?? "Unknown Repo";
                if (Array.isArray(repoData.apps)) {
                    for (const app of repoData.apps) {
                        const fields = [
                            app.name ?? "",
                            app.subtitle ?? app.bundleIdentifier ?? "",
                            app.localizedDescription ?? "",
                        ];

                        let bestScore = Infinity;
                        for (const val of fields) {
                            const score = fuzzyScore(val, keyword);
                            if (score !== null && score < bestScore) {
                                bestScore = score;
                            }
                        }

                        if (bestScore !== Infinity) {
                            results.push({ app, repoName, repoURL: url, score: bestScore });
                        }
                    }
                }
            }
        } catch {
            // skip bad repos silently
        }
    }

    // sort by score ascending
    results.sort((a, b) => a.score - b.score);

    // build HTML, overriding subtitle with repo name
    const finalHtml = results
        .map(({ app, repoName, repoURL }) =>
            buildAppHtml(app, { subtitleOverride: repoName, repo: repoName, repoURL })
        )
        .join("\n");

    return new Response(
        JSON.stringify({ name: `Search results for: ${keyword}`, html: finalHtml }),
        {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }
    );
}

async function handleGetLatest(body, request) {
    // Accept repo URL and app bundle from body or headers (case-insensitive)
    const repoURL =
        body.repoURL ?? body.repoUrl ?? body.repourl ??
        request.headers.get("repoURL") ?? request.headers.get("repourl") ?? request.headers.get("repoUrl");

    const appBundle =
        body.appBundle ?? body.bundle ?? body.appbundle ??
        request.headers.get("appBundle") ?? request.headers.get("appbundle") ?? request.headers.get("app-bundle");

    if (!repoURL) {
        return new Response(JSON.stringify({ error: "Missing repoURL" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!appBundle) {
        return new Response(JSON.stringify({ error: "Missing appBundle" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const repoResp = await fetch(repoURL);
        if (!repoResp.ok) {
            return new Response(JSON.stringify({ error: "Failed to fetch repo JSON" }), {
                status: repoResp.status,
                headers: { "Content-Type": "application/json" },
            });
        }

        const repoData = await repoResp.json();
        const repoName = repoData.name ?? "";
        if (!Array.isArray(repoData.apps)) {
            return new Response(JSON.stringify({ error: "Repo JSON missing apps array" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        for (const app of repoData.apps) {
            if (!app) continue;
            if (app.bundleIdentifier === appBundle) {
                const appForResp = Object.assign({}, app);
                if (repoName !== undefined) appForResp.repo = repoName;
                if (repoURL !== undefined) appForResp.repoURL = repoURL;
                return new Response(JSON.stringify(appForResp), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        return new Response(JSON.stringify({ error: "App not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}

// --- Helpers ---

// Return fuzzy match score (lower = better), or null if no match
function fuzzyScore(text, pattern) {
    text = text.toLowerCase();
    pattern = pattern.toLowerCase();
    let tIndex = 0;
    let score = 0;

    for (let pIndex = 0; pIndex < pattern.length; pIndex++) {
        const char = pattern[pIndex];
        const foundIndex = text.indexOf(char, tIndex);
        if (foundIndex === -1) return null;
        score += foundIndex - tIndex; // penalty for skipped chars
        tIndex = foundIndex + 1;
    }

    const maxAllowed = pattern.length * 2; // tweak factor here
    if (score > maxAllowed) return null;

    return score;
}

function buildAppsHtml(apps, { repo, repoURL } = {}) {
    return apps
        .map((app) => buildAppHtml(app, { repo, repoURL }))
        .join("\n");
}

function buildAppHtml(app, { subtitleOverride, repo, repoURL } = {}) {
    const subtitle =
        subtitleOverride ?? app.subtitle ?? app.bundleIdentifier ?? "";
    const extraStyle = app.tintColor
        ? `box-shadow: 0 2px 8px ${app.tintColor}; background: ${app.tintColor};`
        : "";
    const description = (app.localizedDescription ?? "").replace(/\n/g, "<br>");
    const iconURL = app.iconURL ?? "";
    const name = app.name ?? "";
    const appForEncode = Object.assign({}, app);
    if (repo !== undefined) appForEncode.repo = repo;
    if (repoURL !== undefined) appForEncode.repoURL = repoURL;
    const encodedDict = encodeURIComponent(JSON.stringify(appForEncode));

    let version = "";
    if ("version" in app) {
        version = app.version;
    } else if (Array.isArray(app.versions) && app.versions.length > 0) {
        version = app.versions[0].version ?? "";
    }

    return `
<div class="app-card" style="display: flex; flex-direction: column; gap: 12px; ${extraStyle}">
  <div class="app-main-row" style="display: flex; align-items: center; width: 100%; gap: 12px;">
    <img class="app-icon" src="${iconURL}" alt="App Icon">
    <div class="app-info">
      <div class="app-name">${name}</div>
      <div class="app-subtitle">${subtitle}</div>
    </div>
  </div>
  <details class="app-details-dropdown">
    <summary class="dropdown-summary">
      <span>${version || "Details"}</span>
      <span class="dropdown-arrow">&#9660;</span>
    </summary>
    <div class="app-description">
      ${description}
    </div>
    <div class="copy-value" hidden>${encodedDict}</div>
    <button class="download-btn" type="button">Select</button>
  </details>
</div>`;
}
