import type { App } from "@slack/bolt";
import type { SleepSessionResponse, SleepSessionItem } from "./types/sleepSession";
import { grabData } from "../fetch";
import { grabUser } from "../login";
import { DateTime } from "luxon";

export default async (app: App) => {
    const missingVars = [];

    if (!process.env.HC_GATEWAY_SERVER) missingVars.push("HC_GATEWAY_SERVER");
    if (!process.env.HC_GATEWAY_USERNAME) missingVars.push("HC_GATEWAY_USERNAME");
    if (!process.env.HC_GATEWAY_PASSWORD) missingVars.push("HC_GATEWAY_PASSWORD");
    if (!process.env.CHANNEL) missingVars.push("CHANNEL");

    if (missingVars.length > 0) {
        console.warn("[HC_GATEWAY] Disabled due to missing environment variables:", missingVars.join(", "));
        return;
    } else {
        async function getLastRun(): Promise<{ latest: number | null; lastPostedId?: string }> {
            const f = Bun.file("cache/sleepCache.json");
            if (await f.exists()) {
                const data = await f.json();
                return {
                    latest: data.lastRun ?? null,
                    lastPostedId: data.lastPostedId ?? null
                };
            }
            return { latest: null };
        }

        async function grabSleepAndPost() {
            const user = await grabUser(
                process.env.HC_GATEWAY_SERVER!,
                process.env.HC_GATEWAY_USERNAME!,
                process.env.HC_GATEWAY_PASSWORD!
            );

            if (user.token.length === 0) return;

            const cacheFile = Bun.file("cache/sleepCache.json");
            let cache: {
                lastRun?: number;
                lastPostedId?: string;
                data?: SleepSessionResponse;
            } = {};

            if (await cacheFile.exists()) {
                cache = await cacheFile.json();
            }

            const data = (await grabData(
                process.env.HC_GATEWAY_SERVER!,
                "sleepSession",
                {},
                user.token
            )) as SleepSessionResponse;

            if (!Array.isArray(data) || data.length === 0) {
                console.log("[HC_GATEWAY - Sleep] No sleep sessions found.");
                return;
            }

            const sorted = data.sort(
                (a, b) =>
                    DateTime.fromISO(b.end).toMillis() -
                    DateTime.fromISO(a.end).toMillis()
            );

            const now = DateTime.now().toUTC();
            const lastSleep = sorted[0];

            if (!lastSleep) {
                console.log("[HC_GATEWAY - Sleep] No valid sleep session found.");
                return;
            }

            if (cache.lastPostedId === lastSleep.id) {
                console.log("[HC_GATEWAY - Sleep] Last sleep already posted, skipping.");
                return;
            }

            const sleepStart = DateTime.fromISO(lastSleep.start).setZone("Europe/London");
            const sleepEnd = DateTime.fromISO(lastSleep.end).setZone("Europe/London");
            const duration = sleepEnd.diff(sleepStart, ["hours", "minutes"]);

            const message = `Woah gizzy fell eep at ${sleepStart.toFormat("HH:mm")} then woke up at ${sleepEnd.toFormat("HH:mm")} making a total sleep of ${Math.floor(duration.hours)}h ${Math.round(duration.minutes)}m`;

            await app.client.chat.postMessage({
                channel: String(process.env.CHANNEL),
                text: message
            });

            cache = {
                lastRun: Date.now(),
                lastPostedId: lastSleep.id,
                data
            };

            await Bun.write("cache/sleepCache.json", JSON.stringify(cache, null, 2));
            console.log("[HC_GATEWAY - Sleep] Posted yesterday’s sleep summary.");
        }

        const lastRun = await getLastRun();
        const now = Date.now();

        if (lastRun.latest && now - lastRun.latest < 70 * 60 * 1000) {
            const waitTime = 70 * 60 * 1000 - (now - lastRun.latest);
            console.log(
                `[HC_GATEWAY - Sleep Session] Last check was less than 70 minutes ago. Waiting ${Math.ceil(waitTime / 1000)}s.`
            );
            setTimeout(grabSleepAndPost, waitTime);
        } else {
            grabSleepAndPost();
            setInterval(grabSleepAndPost, 70 * 60 * 1000);
        }
    }
};
