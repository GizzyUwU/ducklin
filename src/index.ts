import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { App } from "@slack/bolt"
import { readdir, realpath, mkdir, stat  } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const loadedModules = new Set<string>();

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: process.env.SLACK_SOCKET_MODE === "true"
})


async function loadModules(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "types") continue;
            await loadModules(fullPath);
        } else if (entry.isFile() && entry.name === "index.ts") {
            const resolvedPath = await realpath(fullPath);
            if (loadedModules.has(resolvedPath)) continue;
            loadedModules.add(resolvedPath);
            try {
                const mod = await import(pathToFileURL(resolvedPath).href);
                if (typeof mod.default === "function") await mod.default(app);

                app.logger.info(`Loaded module: ${resolvedPath}`);
            } catch (err) {
                app.logger.error(`Failed to load module ${resolvedPath}:`, err);
            }
        }
    }
}


(async () => {
    try {
        await stat("./cache")
    } catch {
        await mkdir("./cache")
    }
    await loadModules("src/modules");
    await app.start(process.env.PORT || 3000);
    app.logger.info(`Connected to Slack Successfully ${process.env.SLACK_SOCKET_MODE === "true" ? "" : `on port ${process.env.PORT}`}`);
})();