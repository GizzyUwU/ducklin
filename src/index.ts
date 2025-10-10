import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { App } from "@slack/bolt"
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: Boolean(process.env.SOCKET_MODE)
})
async function loadModules(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "types") {
                continue;
            }
            await loadModules(fullPath);
        } else if (entry.isFile() && entry.name === "index.ts") {
            try {
                const mod = await import(pathToFileURL(fullPath).href);


                if (typeof mod.default === "function") {
                    await mod.default(app);
                }

                for (const [key, fn] of Object.entries(mod)) {
                    if (typeof fn === "function") {
                        await fn(app);
                    }
                }

                app.logger.info(`Loaded module: ${fullPath}`);
            } catch (err) {
                app.logger.error(`Failed to load module ${fullPath}:`, err);
            }
        }
    }
}

(async () => {
    await loadModules("src/modules");
    await app.start(process.env.PORT || 3000);

    app.logger.info('Connected to Slack Successfully');
})();